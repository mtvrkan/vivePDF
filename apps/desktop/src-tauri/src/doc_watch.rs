use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::rpc::RpcError;
use crate::watch_paths::{canonical_form, is_watchable_pdf, snapshot, Snapshot};

pub const CHANGED_EVENT: &str = "document-file-changed";
const DEBOUNCE: Duration = Duration::from_millis(400);
const POLL: Duration = Duration::from_millis(100);

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFileChanged {
    pub path: String,
    pub exists: bool,
}

struct WatchedFile {
    path: String,
    directory: PathBuf,
    count: usize,
    stamp: Option<Snapshot>,
    busy: usize,
}

struct WatchedDirectory {
    path: PathBuf,
    count: usize,
}

#[derive(Default)]
struct Registry {
    files: HashMap<PathBuf, WatchedFile>,
    directories: HashMap<PathBuf, WatchedDirectory>,
}

impl Registry {
    fn add(
        &mut self,
        key: PathBuf,
        path: String,
        directory: (PathBuf, PathBuf),
        stamp: Option<Snapshot>,
    ) -> Option<PathBuf> {
        if let Some(file) = self.files.get_mut(&key) {
            file.count += 1;
            return None;
        }
        let (directory_key, directory_path) = directory;
        self.files.insert(
            key,
            WatchedFile {
                path,
                directory: directory_key.clone(),
                count: 1,
                stamp,
                busy: 0,
            },
        );
        let entry = self
            .directories
            .entry(directory_key)
            .or_insert(WatchedDirectory {
                path: directory_path.clone(),
                count: 0,
            });
        entry.count += 1;
        (entry.count == 1).then_some(directory_path)
    }

    fn remove(&mut self, key: &Path) -> Option<PathBuf> {
        let file = self.files.get_mut(key)?;
        file.count -= 1;
        if file.count > 0 {
            return None;
        }
        let directory_key = file.directory.clone();
        self.files.remove(key);
        let directory = self.directories.get_mut(&directory_key)?;
        directory.count -= 1;
        if directory.count > 0 {
            return None;
        }
        self.directories
            .remove(&directory_key)
            .map(|directory| directory.path)
    }

    fn refresh(&mut self, key: &Path, current: Option<Snapshot>) {
        if let Some(file) = self.files.get_mut(key) {
            file.stamp = current;
        }
    }

    fn is_busy(&self, key: &Path) -> bool {
        self.files.get(key).is_some_and(|file| file.busy > 0)
    }

    fn set_busy(&mut self, key: &Path, busy: bool) -> bool {
        let Some(file) = self.files.get_mut(key) else {
            return false;
        };
        if busy {
            file.busy += 1;
        } else {
            file.busy = file.busy.saturating_sub(1);
        }
        true
    }

    fn settle(&mut self, key: &Path, current: Option<Snapshot>) -> Option<DocumentFileChanged> {
        let file = self.files.get_mut(key)?;
        let exists = change_of(file.stamp, current)?;
        file.stamp = current;
        Some(DocumentFileChanged {
            path: file.path.clone(),
            exists,
        })
    }
}

fn registry() -> MutexGuard<'static, Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| Mutex::new(Registry::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn change_of(previous: Option<Snapshot>, current: Option<Snapshot>) -> Option<bool> {
    (previous != current).then_some(current.is_some())
}

fn due(pending: &HashMap<PathBuf, Instant>, now: Instant) -> Vec<PathBuf> {
    pending
        .iter()
        .filter(|(_, last)| now.duration_since(**last) >= DEBOUNCE)
        .map(|(key, _)| key.clone())
        .collect()
}

pub fn refresh_stamp(path: &Path) {
    let key = canonical_form(path);
    let current = snapshot(path);
    registry().refresh(&key, current);
}

pub(crate) struct WatchedCall {
    key: PathBuf,
    path: PathBuf,
    before: Option<Snapshot>,
}

pub(crate) fn begin_call(params: &Value) -> Option<WatchedCall> {
    let path = PathBuf::from(params.get("path")?.as_str()?);
    let key = canonical_form(&path);
    if !registry().set_busy(&key, true) {
        return None;
    }
    let before = snapshot(&path);
    Some(WatchedCall { key, path, before })
}

pub(crate) fn end_call(call: Option<WatchedCall>) {
    let Some(call) = call else {
        return;
    };
    let current = snapshot(&call.path);
    let mut registry = registry();
    if current != call.before {
        registry.refresh(&call.key, current);
    }
    registry.set_busy(&call.key, false);
}

#[derive(Default)]
pub struct DocumentWatch(Mutex<Option<RecommendedWatcher>>);

fn spawn_listener(app: AppHandle, receiver: Receiver<notify::Result<Event>>) {
    std::thread::spawn(move || {
        let mut pending: HashMap<PathBuf, Instant> = HashMap::new();
        loop {
            match receiver.recv_timeout(POLL) {
                Ok(Ok(event)) => {
                    if !matches!(event.kind, EventKind::Access(_)) {
                        let now = Instant::now();
                        let registry = registry();
                        for path in &event.paths {
                            let key = canonical_form(path);
                            if registry.files.contains_key(&key) {
                                pending.insert(key, now);
                            }
                        }
                    }
                }
                Ok(Err(_)) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            for key in due(&pending, Instant::now()) {
                if registry().is_busy(&key) {
                    pending.insert(key, Instant::now());
                    continue;
                }
                pending.remove(&key);
                let path = registry().files.get(&key).map(|file| file.path.clone());
                let Some(path) = path else {
                    continue;
                };
                let current = snapshot(Path::new(&path));
                let changed = registry().settle(&key, current);
                if let Some(changed) = changed {
                    let _ = app.emit(CHANGED_EVENT, changed);
                }
            }
        }
    });
}

fn watch_error(error: notify::Error) -> RpcError {
    RpcError::new("INTERNAL", error.to_string())
}

#[tauri::command]
pub fn watch_document(
    app: AppHandle,
    state: State<'_, DocumentWatch>,
    path: String,
) -> Result<(), RpcError> {
    let target = PathBuf::from(&path);
    if !is_watchable_pdf(&target) {
        return Err(RpcError::new(
            "INVALID_PARAMS",
            format!("not a PDF file: {path}"),
        ));
    }
    let Some(directory) = target.parent().filter(|parent| parent.is_dir()) else {
        return Err(RpcError::new(
            "FILE_NOT_FOUND",
            format!("folder not found: {path}"),
        ));
    };
    let mut watcher = state
        .0
        .lock()
        .map_err(|_| RpcError::new("INTERNAL", "document watch lock poisoned"))?;
    if watcher.is_none() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let created = recommended_watcher(move |event| {
            let _ = sender.send(event);
        })
        .map_err(watch_error)?;
        spawn_listener(app, receiver);
        *watcher = Some(created);
    }
    let key = canonical_form(&target);
    let directory_key = canonical_form(directory);
    let started = registry().add(
        key.clone(),
        path.clone(),
        (directory_key, directory.to_path_buf()),
        snapshot(&target),
    );
    if let (Some(directory), Some(active)) = (started, watcher.as_mut()) {
        if let Err(error) = active.watch(&directory, RecursiveMode::NonRecursive) {
            registry().remove(&key);
            return Err(watch_error(error));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn unwatch_document(state: State<'_, DocumentWatch>, path: String) -> Result<(), RpcError> {
    let mut watcher = state
        .0
        .lock()
        .map_err(|_| RpcError::new("INTERNAL", "document watch lock poisoned"))?;
    let stopped = registry().remove(&canonical_form(Path::new(&path)));
    if let (Some(directory), Some(active)) = (stopped, watcher.as_mut()) {
        let _ = active.unwatch(&directory);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;

    fn stamp(length: u64, millis: u64) -> Option<Snapshot> {
        Some((length, Some(UNIX_EPOCH + Duration::from_millis(millis))))
    }

    fn directory() -> (PathBuf, PathBuf) {
        (PathBuf::from("c:/docs"), PathBuf::from("C:/Docs"))
    }

    #[test]
    fn an_equal_stamp_reports_nothing() {
        assert_eq!(change_of(stamp(10, 5), stamp(10, 5)), None);
    }

    #[test]
    fn a_changed_stamp_reports_an_existing_file() {
        assert_eq!(change_of(stamp(10, 5), stamp(12, 9)), Some(true));
        assert_eq!(change_of(stamp(10, 5), stamp(10, 9)), Some(true));
    }

    #[test]
    fn a_missing_file_reports_it_is_gone() {
        assert_eq!(change_of(stamp(10, 5), None), Some(false));
        assert_eq!(change_of(None, None), None);
        assert_eq!(change_of(None, stamp(1, 1)), Some(true));
    }

    #[test]
    fn only_quiet_files_are_due() {
        let now = Instant::now();
        let mut pending = HashMap::new();
        pending.insert(PathBuf::from("a.pdf"), now - DEBOUNCE);
        pending.insert(PathBuf::from("b.pdf"), now - Duration::from_millis(50));
        assert_eq!(due(&pending, now), vec![PathBuf::from("a.pdf")]);
    }

    #[test]
    fn a_settled_change_is_reported_once() {
        let mut registry = Registry::default();
        let key = PathBuf::from("c:/docs/a.pdf");
        registry.add(
            key.clone(),
            "C:/Docs/a.pdf".into(),
            directory(),
            stamp(1, 1),
        );
        let changed = registry.settle(&key, stamp(2, 2));
        assert_eq!(
            changed,
            Some(DocumentFileChanged {
                path: "C:/Docs/a.pdf".into(),
                exists: true
            })
        );
        assert_eq!(registry.settle(&key, stamp(2, 2)), None);
    }

    #[test]
    fn a_self_write_refresh_suppresses_the_event() {
        let mut registry = Registry::default();
        let key = PathBuf::from("c:/docs/a.pdf");
        registry.add(
            key.clone(),
            "C:/Docs/a.pdf".into(),
            directory(),
            stamp(1, 1),
        );
        registry.refresh(&key, stamp(3, 3));
        assert_eq!(registry.settle(&key, stamp(3, 3)), None);
    }

    #[test]
    fn a_file_is_busy_only_while_a_call_on_it_runs() {
        let mut registry = Registry::default();
        let key = PathBuf::from("c:/docs/a.pdf");
        registry.add(key.clone(), "a".into(), directory(), stamp(1, 1));
        assert!(registry.set_busy(&key, true));
        assert!(registry.is_busy(&key));
        registry.set_busy(&key, false);
        assert!(!registry.is_busy(&key));
        assert!(!registry.set_busy(Path::new("x.pdf"), true));
    }

    #[test]
    fn directories_are_reference_counted() {
        let mut registry = Registry::default();
        let first = PathBuf::from("c:/docs/a.pdf");
        let second = PathBuf::from("c:/docs/b.pdf");
        assert_eq!(
            registry.add(first.clone(), "a".into(), directory(), None),
            Some(PathBuf::from("C:/Docs"))
        );
        assert_eq!(
            registry.add(first.clone(), "a".into(), directory(), None),
            None
        );
        assert_eq!(
            registry.add(second.clone(), "b".into(), directory(), None),
            None
        );
        assert_eq!(registry.remove(&first), None);
        assert_eq!(registry.remove(&first), None);
        assert_eq!(registry.remove(&second), Some(PathBuf::from("C:/Docs")));
        assert!(registry.files.is_empty());
    }

    #[test]
    fn unknown_files_are_ignored() {
        let mut registry = Registry::default();
        assert_eq!(registry.remove(Path::new("x.pdf")), None);
        assert_eq!(registry.settle(Path::new("x.pdf"), None), None);
    }
}

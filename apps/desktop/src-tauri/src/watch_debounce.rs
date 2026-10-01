use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{Event, EventKind};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::watch_paths::{
    is_excluded, is_readable, is_watchable_pdf, snapshot, unchanged, Snapshot,
};

const DEBOUNCE: Duration = Duration::from_millis(1500);
const ROOT_CHECK: Duration = Duration::from_secs(5);
const MAX_SETTLE: Duration = Duration::from_secs(600);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WatchFileEvent {
    pub id: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WatchFolderError {
    pub id: String,
    pub message: String,
}

impl WatchFileEvent {
    fn new(id: &str, path: &Path, seen: Option<Snapshot>) -> Self {
        let (size, modified) = seen.unwrap_or((0, None));
        let modified = modified
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_millis() as u64)
            .unwrap_or(0);
        Self {
            id: id.to_string(),
            path: path.to_string_lossy().to_string(),
            size,
            modified,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Settle {
    Ready,
    Wait,
    GiveUp,
}

#[derive(Clone, Copy)]
struct Pending {
    ready_at: Instant,
    first_seen: Instant,
    seen: Option<Snapshot>,
}

fn settle(waited: Duration, stable: bool) -> Settle {
    if stable {
        return Settle::Ready;
    }
    if waited >= MAX_SETTLE {
        return Settle::GiveUp;
    }
    Settle::Wait
}

pub(crate) fn spawn_debouncer(
    app: AppHandle,
    id: String,
    receiver: std::sync::mpsc::Receiver<notify::Result<Event>>,
    stop: Arc<AtomicBool>,
    exclude: Option<PathBuf>,
    root: PathBuf,
) {
    std::thread::spawn(move || {
        let mut pending: HashMap<PathBuf, Pending> = HashMap::new();
        let mut root_checked = Instant::now();
        loop {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            if root_checked.elapsed() >= ROOT_CHECK {
                root_checked = Instant::now();
                if !root.is_dir() {
                    let _ = app.emit("watch-folder-lost", WatchFileEvent::new(&id, &root, None));
                    return;
                }
            }
            match receiver.recv_timeout(Duration::from_millis(200)) {
                Ok(Ok(event)) => {
                    if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                        continue;
                    }
                    for path in event.paths {
                        if path.is_dir()
                            || !is_watchable_pdf(&path)
                            || is_excluded(&path, exclude.as_deref())
                        {
                            continue;
                        }
                        let now = Instant::now();
                        let seen = snapshot(&path);
                        pending
                            .entry(path)
                            .and_modify(|entry| {
                                entry.ready_at = now;
                                entry.seen = seen;
                            })
                            .or_insert(Pending {
                                ready_at: now,
                                first_seen: now,
                                seen,
                            });
                    }
                }
                Ok(Err(error)) => {
                    let _ = app.emit(
                        "watch-folder-error",
                        WatchFolderError {
                            id: id.clone(),
                            message: error.to_string(),
                        },
                    );
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            let now = Instant::now();
            let ready: Vec<PathBuf> = pending
                .iter()
                .filter(|(_, entry)| now.duration_since(entry.ready_at) >= DEBOUNCE)
                .map(|(path, _)| path.clone())
                .collect();
            for path in ready {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                let Some(entry) = pending.get(&path).copied() else {
                    continue;
                };
                if !path.is_file() {
                    pending.remove(&path);
                    continue;
                }
                let waited = Instant::now().duration_since(entry.first_seen);
                let current = snapshot(&path);
                let stable = unchanged(entry.seen, current) && is_readable(&path);
                match settle(waited, stable) {
                    Settle::Wait => {
                        pending.insert(
                            path,
                            Pending {
                                ready_at: Instant::now(),
                                first_seen: entry.first_seen,
                                seen: current,
                            },
                        );
                    }
                    Settle::GiveUp => {
                        pending.remove(&path);
                        let _ = app.emit(
                            "watch-file-stalled",
                            WatchFileEvent::new(&id, &path, current),
                        );
                    }
                    Settle::Ready => {
                        pending.remove(&path);
                        let _ = app.emit("watch-file", WatchFileEvent::new(&id, &path, current));
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_that_stopped_growing_is_ready() {
        assert_eq!(settle(Duration::from_secs(1), true), Settle::Ready);
    }

    #[test]
    fn a_file_still_being_written_is_waited_for() {
        assert_eq!(settle(Duration::from_secs(30), false), Settle::Wait);
    }

    #[test]
    fn a_file_that_never_settles_is_given_up_on() {
        assert_eq!(settle(MAX_SETTLE, false), Settle::GiveUp);
    }

    #[test]
    fn a_settled_file_is_taken_however_long_it_took() {
        assert_eq!(settle(MAX_SETTLE * 2, true), Settle::Ready);
    }

    #[test]
    fn the_event_carries_the_size_and_time_the_file_settled_at() {
        let when = std::time::UNIX_EPOCH + Duration::from_millis(1_700_000_000_123);
        let event = WatchFileEvent::new("rule", Path::new("C:/in/a.pdf"), Some((42, Some(when))));
        assert_eq!(event.size, 42);
        assert_eq!(event.modified, 1_700_000_000_123);
        let unknown = WatchFileEvent::new("rule", Path::new("C:/in/a.pdf"), None);
        assert_eq!((unknown.size, unknown.modified), (0, 0));
    }
}

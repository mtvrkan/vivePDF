use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use notify::{recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, State};

use crate::rpc::RpcError;
use crate::watch_debounce::spawn_debouncer;
use crate::watch_paths::{
    canonical_form, is_excluded, is_protected_root, is_watchable_pdf, path_relation, PathRelation,
};

const MAX_WATCHERS: usize = 8;

struct WatcherHandle {
    watcher: RecommendedWatcher,
    stop: Arc<AtomicBool>,
    scope: RuleScope,
}

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, WatcherHandle>>);

#[derive(Clone, Debug)]
pub struct RuleScope {
    pub root: PathBuf,
    pub exclude: Option<PathBuf>,
    pub recursive: bool,
    pub chain_id: Option<String>,
}

impl RuleScope {
    pub fn covers(&self, path: &Path) -> bool {
        if !path.is_file() || !is_watchable_pdf(path) || is_excluded(path, self.exclude.as_deref())
        {
            return false;
        }
        let canonical = canonical_form(path);
        if canonical == self.root || !canonical.starts_with(&self.root) {
            return false;
        }
        self.recursive || canonical.parent() == Some(self.root.as_path())
    }
}

pub fn rule_scope(watchers: &Watchers, id: &str) -> Option<RuleScope> {
    watchers
        .0
        .lock()
        .ok()
        .and_then(|watchers| watchers.get(id).map(|handle| handle.scope.clone()))
}

fn refused(reason: &str, message: String) -> RpcError {
    RpcError {
        code: "INVALID_PARAMS".to_string(),
        message,
        data: Some(serde_json::json!({ "reason": reason })),
    }
}

#[tauri::command]
pub fn watch_folder_start(
    app: AppHandle,
    state: State<'_, Watchers>,
    id: String,
    path: String,
    recursive: bool,
    exclude: Option<String>,
    chain_id: Option<String>,
) -> Result<(), RpcError> {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Err(RpcError::new(
            "FILE_NOT_FOUND",
            format!("not a directory: {path}"),
        ));
    }
    let canonical = std::fs::canonicalize(&target).unwrap_or_else(|_| target.clone());
    if is_protected_root(&canonical) {
        return Err(refused(
            "systemFolder",
            format!("refusing to watch a system directory: {path}"),
        ));
    }
    let mut watchers = state
        .0
        .lock()
        .map_err(|_| RpcError::new("INTERNAL", "watcher lock poisoned"))?;
    if !watchers.contains_key(&id) && watchers.len() >= MAX_WATCHERS {
        return Err(refused(
            "tooManyWatchers",
            format!("too many active watchers (max {MAX_WATCHERS})"),
        ));
    }
    if let Some(previous) = watchers.remove(&id) {
        previous.stop.store(true, Ordering::Relaxed);
        drop(previous.watcher);
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    let mut watcher = recommended_watcher(move |event| {
        let _ = sender.send(event);
    })
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };
    watcher
        .watch(&target, mode)
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;

    let stop = Arc::new(AtomicBool::new(false));
    let exclude = exclude
        .filter(|value| !value.trim().is_empty())
        .map(|value| canonical_form(Path::new(&value)));
    let scope = RuleScope {
        root: canonical_form(&target),
        exclude: exclude.clone(),
        recursive,
        chain_id: chain_id.filter(|value| crate::chain_secrets::valid_chain_id(value)),
    };
    spawn_debouncer(
        app,
        id.clone(),
        receiver,
        stop.clone(),
        exclude,
        target.clone(),
    );
    watchers.insert(
        id,
        WatcherHandle {
            watcher,
            stop,
            scope,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn watch_path_relation(path: String, base: String) -> PathRelation {
    path_relation(Path::new(&path), Path::new(&base))
}

#[tauri::command]
pub fn watch_folder_stop(state: State<'_, Watchers>, id: String) -> Result<(), RpcError> {
    let mut watchers = state
        .0
        .lock()
        .map_err(|_| RpcError::new("INTERNAL", "watcher lock poisoned"))?;
    if let Some(handle) = watchers.remove(&id) {
        handle.stop.store(true, Ordering::Relaxed);
        drop(handle.watcher);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refused_folder_uses_a_code_the_ui_translates() {
        let error = refused("systemFolder", "x".to_string());
        assert_eq!(error.code, "INVALID_PARAMS");
        assert_eq!(error.data.unwrap()["reason"], "systemFolder");
    }
}

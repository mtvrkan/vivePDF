use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

use crate::launch::LaunchRequest;
use crate::rpc::RpcError;

pub const MAIN_WINDOW: &str = "main";
const LABEL_PREFIX: &str = "doc-";
const MAX_PATHS: usize = 64;
const MAX_CLAIMS: usize = 1024;

#[derive(Default)]
pub struct DocumentWindows {
    pending: Mutex<HashMap<String, LaunchRequest>>,
    claims: Mutex<HashMap<String, String>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusDocument {
    label: String,
    path: String,
}

impl DocumentWindows {
    fn entries(&self) -> MutexGuard<'_, HashMap<String, LaunchRequest>> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn remember(&self, label: &str, request: LaunchRequest) {
        self.entries().insert(label.to_string(), request);
    }

    fn forget(&self, label: &str) {
        self.entries().remove(label);
    }

    pub fn request_for(&self, label: &str) -> LaunchRequest {
        self.entries().get(label).cloned().unwrap_or_default()
    }

    fn claim_entries(&self) -> MutexGuard<'_, HashMap<String, String>> {
        self.claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn claim(&self, label: &str, path: &str, is_open: impl Fn(&str) -> bool) -> Option<String> {
        let mut claims = self.claim_entries();
        let key = claim_key(path);
        if let Some(owner) = claims.get(&key) {
            if owner != label && is_open(owner) {
                return Some(owner.clone());
            }
        }
        claims.insert(key, label.to_string());
        None
    }

    fn sync(&self, label: &str, paths: &[String], is_open: impl Fn(&str) -> bool) {
        let mut claims = self.claim_entries();
        let wanted: HashSet<String> = paths.iter().map(|path| claim_key(path)).collect();
        claims.retain(|key, owner| owner != label || wanted.contains(key));
        for key in wanted {
            let held_elsewhere = claims
                .get(&key)
                .is_some_and(|owner| owner != label && is_open(owner));
            if !held_elsewhere {
                claims.insert(key, label.to_string());
            }
        }
    }

    fn hand_over(&self, from: &str, to: &str, paths: &[String]) {
        let mut claims = self.claim_entries();
        for path in paths {
            let key = claim_key(path);
            if claims.get(&key).is_some_and(|owner| owner == from) {
                claims.insert(key, to.to_string());
            }
        }
    }

    pub fn release_window(&self, label: &str) {
        self.claim_entries().retain(|_, owner| owner != label);
    }
}

fn claim_key(path: &str) -> String {
    let resolved = std::fs::canonicalize(path)
        .map(|resolved| resolved.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string());
    if cfg!(any(windows, target_os = "macos")) {
        resolved.to_lowercase()
    } else {
        resolved
    }
}

fn is_open_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    app.get_webview_window(label).is_some()
}

fn bring_forward<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn new_label() -> String {
    format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4().simple())
}

pub fn existing_files(paths: Vec<String>) -> Result<Vec<String>, RpcError> {
    if paths.len() > MAX_PATHS {
        return Err(RpcError::new("INVALID_PARAMS", "too many paths"));
    }
    Ok(paths
        .into_iter()
        .filter(|path| Path::new(path).is_absolute() && Path::new(path).is_file())
        .collect())
}

pub fn open_window<R: Runtime>(
    app: &AppHandle<R>,
    request: LaunchRequest,
) -> tauri::Result<WebviewWindow<R>> {
    let label = new_label();
    let windows = app.state::<DocumentWindows>();
    windows.remember(&label, request);
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("vivePDF")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .focused(true);
    #[cfg(target_os = "macos")]
    let built = built
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 17.0));
    #[cfg(not(target_os = "macos"))]
    let built = built.decorations(false);
    let built = built.build();
    match built {
        Ok(window) => {
            let handle = app.clone();
            let closing = label.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Destroyed = event {
                    handle.state::<DocumentWindows>().forget(&closing);
                }
            });
            Ok(window)
        }
        Err(error) => {
            windows.forget(&label);
            Err(error)
        }
    }
}

pub fn deliver_launch<R: Runtime>(app: &AppHandle<R>, request: LaunchRequest, show: bool) {
    use tauri::Emitter;
    if app.get_webview_window(MAIN_WINDOW).is_some() {
        if show {
            crate::tray::show_main_window(app);
        }
        let _ = app.emit_to(MAIN_WINDOW, "launch", request);
        return;
    }
    if !show && request.paths.is_empty() {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = open_window(&handle, request) {
            crate::diagnostics::log_sidecar(
                &handle,
                "error",
                &format!("window open failed: {error}"),
            );
        }
    });
}

#[tauri::command]
pub async fn window_open<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    paths: Vec<String>,
) -> Result<String, RpcError> {
    let paths = existing_files(paths)?;
    let opened = open_window(
        &app,
        LaunchRequest {
            tool: None,
            paths: paths.clone(),
        },
    )
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    app.state::<DocumentWindows>()
        .hand_over(window.label(), opened.label(), &paths);
    Ok(opened.label().to_string())
}

#[tauri::command]
pub fn document_claim<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    path: String,
) -> Option<String> {
    let owner = app
        .state::<DocumentWindows>()
        .claim(window.label(), &path, |label| is_open_window(&app, label))?;
    if let Some(holder) = app.get_webview_window(&owner) {
        bring_forward(&holder);
        let _ = app.emit_to(
            owner.as_str(),
            "focus-document",
            FocusDocument {
                label: owner.clone(),
                path,
            },
        );
    }
    Some(owner)
}

#[tauri::command]
pub fn document_claims_sync<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    paths: Vec<String>,
) -> Result<(), RpcError> {
    if paths.len() > MAX_CLAIMS {
        return Err(RpcError::new("INVALID_PARAMS", "too many paths"));
    }
    app.state::<DocumentWindows>()
        .sync(window.label(), &paths, |label| is_open_window(&app, label));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_match_the_capability_pattern() {
        let label = new_label();
        let suffix = label.strip_prefix("doc-").unwrap();
        assert_eq!(suffix.len(), 32);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(new_label(), label);
    }

    #[test]
    fn keeps_only_existing_absolute_files() {
        let directory = std::env::temp_dir().join("vivepdf-window-test");
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("a.pdf");
        std::fs::write(&file, b"%PDF-1.4").unwrap();
        let kept = existing_files(vec![
            file.to_string_lossy().to_string(),
            directory.join("missing.pdf").to_string_lossy().to_string(),
            "a.pdf".to_string(),
            directory.to_string_lossy().to_string(),
        ])
        .unwrap();
        assert_eq!(kept, vec![file.to_string_lossy().to_string()]);
    }

    #[test]
    fn refuses_too_many_paths() {
        let error = existing_files(vec!["x".to_string(); MAX_PATHS + 1]).unwrap_err();
        assert_eq!(error.code, "INVALID_PARAMS");
    }

    #[test]
    fn pending_requests_are_per_window_and_forgotten() {
        let windows = DocumentWindows::default();
        let request = LaunchRequest {
            tool: None,
            paths: vec!["a.pdf".to_string()],
        };
        windows.remember("doc-1", request.clone());
        assert_eq!(windows.request_for("doc-1"), request);
        assert_eq!(windows.request_for("doc-2"), LaunchRequest::default());
        windows.forget("doc-1");
        assert_eq!(windows.request_for("doc-1"), LaunchRequest::default());
    }

    fn all_open(_: &str) -> bool {
        true
    }

    fn paths(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn a_document_open_in_another_window_names_that_window() {
        let windows = DocumentWindows::default();
        assert_eq!(windows.claim("main", "C:/Docs/a.pdf", all_open), None);
        assert_eq!(windows.claim("main", "C:/Docs/a.pdf", all_open), None);
        assert_eq!(
            windows.claim("doc-1", "C:/Docs/a.pdf", all_open),
            Some("main".to_string())
        );
        assert_eq!(windows.claim("doc-1", "C:/Docs/b.pdf", all_open), None);
    }

    #[test]
    fn a_claim_held_by_a_closed_window_passes_on() {
        let windows = DocumentWindows::default();
        windows.claim("doc-1", "a.pdf", all_open);
        assert_eq!(
            windows.claim("main", "a.pdf", |label| label != "doc-1"),
            None
        );
        assert_eq!(
            windows.claim("doc-2", "a.pdf", all_open),
            Some("main".to_string())
        );
    }

    #[test]
    fn same_file_under_other_spellings_is_one_claim() {
        let directory = std::env::temp_dir().join("vivepdf-claim-test");
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("Same.pdf");
        std::fs::write(&file, b"%PDF-1.4").unwrap();
        let windows = DocumentWindows::default();
        windows.claim("main", &file.to_string_lossy(), all_open);
        let dotted = directory.join(".").join("Same.pdf");
        assert_eq!(
            windows.claim("doc-1", &dotted.to_string_lossy(), all_open),
            Some("main".to_string())
        );
        if cfg!(windows) {
            let upper = file.to_string_lossy().to_uppercase();
            assert_eq!(
                windows.claim("doc-1", &upper, all_open),
                Some("main".to_string())
            );
        }
    }

    #[test]
    fn sync_replaces_only_the_callers_claims() {
        let windows = DocumentWindows::default();
        windows.sync("main", &paths(&["a.pdf", "b.pdf"]), all_open);
        windows.sync("doc-1", &paths(&["b.pdf", "c.pdf"]), all_open);
        assert_eq!(
            windows.claim("doc-2", "b.pdf", all_open),
            Some("main".into())
        );
        assert_eq!(
            windows.claim("doc-2", "c.pdf", all_open),
            Some("doc-1".into())
        );
        windows.sync("main", &paths(&["a.pdf"]), all_open);
        assert_eq!(windows.claim("doc-2", "b.pdf", all_open), None);
        assert_eq!(
            windows.claim("doc-1", "a.pdf", all_open),
            Some("main".into())
        );
    }

    #[test]
    fn moving_a_document_hands_its_claim_to_the_new_window() {
        let windows = DocumentWindows::default();
        windows.sync("main", &paths(&["a.pdf", "b.pdf"]), all_open);
        windows.hand_over("main", "doc-1", &paths(&["a.pdf", "x.pdf"]));
        assert_eq!(windows.claim("doc-1", "a.pdf", all_open), None);
        assert_eq!(
            windows.claim("main", "a.pdf", all_open),
            Some("doc-1".into())
        );
        assert_eq!(windows.claim("doc-1", "x.pdf", all_open), None);
        windows.sync("main", &paths(&["a.pdf", "b.pdf"]), all_open);
        assert_eq!(
            windows.claim("doc-2", "a.pdf", all_open),
            Some("doc-1".into())
        );
    }

    #[test]
    fn a_closed_window_releases_everything_it_held() {
        let windows = DocumentWindows::default();
        windows.sync("doc-1", &paths(&["a.pdf", "b.pdf"]), all_open);
        windows.release_window("doc-1");
        assert_eq!(windows.claim("main", "a.pdf", all_open), None);
        assert_eq!(windows.claim("main", "b.pdf", all_open), None);
    }
}

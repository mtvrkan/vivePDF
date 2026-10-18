use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
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
const MAX_GROUP_NAME: usize = 40;
const WINDOW_WIDTH: f64 = 1280.0;
const WINDOW_HEIGHT: f64 = 800.0;
const GRAB_X: f64 = 120.0;
const GRAB_Y: f64 = 18.0;

#[derive(Default)]
pub struct DocumentWindows {
    pending: Mutex<HashMap<String, LaunchRequest>>,
    claims: Mutex<HashMap<String, String>>,
    focused: Mutex<HashMap<String, u64>>,
    focus_count: AtomicU64,
    hovered: Mutex<Option<String>>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Candidate {
    label: String,
    bounds: Bounds,
    focused: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedGroup {
    name: String,
    color: String,
    collapsed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
struct DropArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TabDrop {
    paths: Vec<String>,
    #[serde(flatten)]
    area: DropArea,
    group: Option<DroppedGroup>,
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
        if crate::presenter::is_audience(label) {
            return None;
        }
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
        if crate::presenter::is_audience(label) {
            return;
        }
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
        self.focus_entries().remove(label);
    }

    fn focus_entries(&self) -> MutexGuard<'_, HashMap<String, u64>> {
        self.focused
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn note_focus(&self, label: &str) {
        let count = self.focus_count.fetch_add(1, Ordering::Relaxed) + 1;
        self.focus_entries().insert(label.to_string(), count);
    }

    fn focused_at(&self, label: &str) -> u64 {
        self.focus_entries().get(label).copied().unwrap_or_default()
    }

    fn hover(&self, next: Option<&str>) -> Option<String> {
        let mut hovered = self
            .hovered
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = hovered.take();
        *hovered = next.map(str::to_string);
        previous.filter(|label| Some(label.as_str()) != next)
    }
}

fn is_document_window(label: &str) -> bool {
    label == MAIN_WINDOW || label.starts_with(LABEL_PREFIX)
}

fn pick_target<'a>(
    x: f64,
    y: f64,
    source: &str,
    candidates: &'a [Candidate],
) -> Option<&'a Candidate> {
    candidates
        .iter()
        .filter(|candidate| candidate.label != source && is_document_window(&candidate.label))
        .filter(|candidate| candidate.bounds.contains(x, y))
        .max_by_key(|candidate| candidate.focused)
}

fn candidate_of<R: Runtime>(window: &WebviewWindow<R>, focused: u64) -> Option<Candidate> {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return None;
    }
    let position = window.inner_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(Candidate {
        label: window.label().to_string(),
        bounds: Bounds {
            x: f64::from(position.x),
            y: f64::from(position.y),
            width: f64::from(size.width),
            height: f64::from(size.height),
        },
        focused,
    })
}

fn placed_at_cursor(x: f64, y: f64, work: Bounds) -> Bounds {
    let width = WINDOW_WIDTH.min(work.width);
    let height = WINDOW_HEIGHT.min(work.height);
    Bounds {
        x: (x - GRAB_X).clamp(work.x, work.x + work.width - width),
        y: (y - GRAB_Y).clamp(work.y, work.y + work.height - height),
        width,
        height,
    }
}

fn cursor_placement<R: Runtime>(app: &AppHandle<R>) -> Option<Bounds> {
    let cursor = app.cursor_position().ok()?;
    let monitor = app.monitor_from_point(cursor.x, cursor.y).ok().flatten()?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let work = Bounds {
        x: f64::from(area.position.x) / scale,
        y: f64::from(area.position.y) / scale,
        width: f64::from(area.size.width) / scale,
        height: f64::from(area.size.height) / scale,
    };
    Some(placed_at_cursor(cursor.x / scale, cursor.y / scale, work))
}

fn trimmed_group(group: Option<DroppedGroup>) -> Option<DroppedGroup> {
    group.map(|group| DroppedGroup {
        name: group.name.chars().take(MAX_GROUP_NAME).collect(),
        ..group
    })
}

pub(crate) fn claim_key(path: &str) -> String {
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

fn open_window<R: Runtime>(
    app: &AppHandle<R>,
    request: LaunchRequest,
    placement: Option<Bounds>,
) -> tauri::Result<WebviewWindow<R>> {
    let label = new_label();
    let windows = app.state::<DocumentWindows>();
    windows.remember(&label, request);
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("vivePDF")
        .min_inner_size(900.0, 600.0)
        .focused(true);
    let built = match placement {
        Some(area) => built
            .inner_size(area.width, area.height)
            .position(area.x, area.y),
        None => built.inner_size(WINDOW_WIDTH, WINDOW_HEIGHT).center(),
    };
    #[cfg(target_os = "macos")]
    let built = built
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 26.0));
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
    crate::grants::allow_paths(&request.paths);
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
        if let Err(error) = open_window(&handle, request, None) {
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
    at_cursor: Option<bool>,
    group: Option<DroppedGroup>,
) -> Result<String, RpcError> {
    let paths = existing_files(paths)?;
    let placement = if at_cursor.unwrap_or(false) {
        cursor_placement(&app)
    } else {
        None
    };
    let opened = open_window(
        &app,
        LaunchRequest {
            tool: None,
            paths: paths.clone(),
            group: trimmed_group(group),
        },
        placement,
    )
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    app.state::<DocumentWindows>()
        .hand_over(window.label(), opened.label(), &paths);
    Ok(opened.label().to_string())
}

#[tauri::command]
pub fn tab_drop<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    paths: Vec<String>,
    group: Option<DroppedGroup>,
) -> Result<Option<String>, RpcError> {
    let paths = existing_files(paths)?;
    if paths.is_empty() {
        return Ok(None);
    }
    leave_hovered(&app, None);
    let Some((holder, area)) = window_under_cursor(&app, window.label())? else {
        return Ok(None);
    };
    let label = holder.label().to_string();
    app.state::<DocumentWindows>()
        .hand_over(window.label(), &label, &paths);
    bring_forward(&holder);
    let _ = app.emit_to(
        label.as_str(),
        "tab-drop",
        TabDrop {
            paths,
            area,
            group: trimmed_group(group),
        },
    );
    Ok(Some(label))
}

#[tauri::command]
pub fn tab_drag_over<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    active: bool,
) -> Result<(), RpcError> {
    if !active {
        leave_hovered(&app, None);
        return Ok(());
    }
    let hit = window_under_cursor(&app, window.label())?;
    let label = hit.as_ref().map(|(holder, _)| holder.label().to_string());
    leave_hovered(&app, label.as_deref());
    if let Some((holder, area)) = hit {
        let _ = app.emit_to(holder.label(), "tab-drag-over", area);
    }
    Ok(())
}

fn leave_hovered<R: Runtime>(app: &AppHandle<R>, next: Option<&str>) {
    if let Some(previous) = app.state::<DocumentWindows>().hover(next) {
        let _ = app.emit_to(previous.as_str(), "tab-drag-leave", ());
    }
}

fn window_under_cursor<R: Runtime>(
    app: &AppHandle<R>,
    source: &str,
) -> Result<Option<(WebviewWindow<R>, DropArea)>, RpcError> {
    let cursor = app
        .cursor_position()
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    let windows = app.state::<DocumentWindows>();
    let candidates: Vec<Candidate> = app
        .webview_windows()
        .values()
        .filter_map(|entry| candidate_of(entry, windows.focused_at(entry.label())))
        .collect();
    let Some(target) = pick_target(cursor.x, cursor.y, source, &candidates) else {
        return Ok(None);
    };
    let Some(holder) = app.get_webview_window(&target.label) else {
        return Ok(None);
    };
    let scale = holder.scale_factor().unwrap_or(1.0);
    let area = DropArea {
        x: (cursor.x - target.bounds.x) / scale,
        y: (cursor.y - target.bounds.y) / scale,
        width: target.bounds.width / scale,
        height: target.bounds.height / scale,
    };
    Ok(Some((holder, area)))
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
            group: None,
        };
        windows.remember("doc-1", request.clone());
        assert_eq!(windows.request_for("doc-1"), request);
        assert_eq!(windows.request_for("doc-2"), LaunchRequest::default());
        windows.forget("doc-1");
        assert_eq!(windows.request_for("doc-1"), LaunchRequest::default());
    }

    #[test]
    fn a_new_window_request_carries_the_group_only_when_there_is_one() {
        let grouped = LaunchRequest {
            tool: None,
            paths: paths(&["a.pdf"]),
            group: trimmed_group(Some(DroppedGroup {
                name: "Pack".to_string(),
                color: "teal".to_string(),
                collapsed: true,
            })),
        };
        assert_eq!(
            serde_json::to_value(&grouped).unwrap(),
            serde_json::json!({
                "tool": null,
                "paths": ["a.pdf"],
                "group": { "name": "Pack", "color": "teal", "collapsed": true }
            })
        );
        let loose = LaunchRequest {
            group: None,
            ..grouped
        };
        assert!(serde_json::to_value(&loose).unwrap().get("group").is_none());
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
    fn audience_windows_never_claim_documents() {
        let windows = DocumentWindows::default();
        assert_eq!(windows.claim("present-1", "a.pdf", all_open), None);
        windows.sync("present-1", &paths(&["b.pdf"]), all_open);
        assert_eq!(windows.claim("main", "a.pdf", all_open), None);
        assert_eq!(windows.claim("main", "b.pdf", all_open), None);
        windows.claim("main", "c.pdf", all_open);
        assert_eq!(windows.claim("present-1", "c.pdf", all_open), None);
        assert_eq!(
            windows.claim("doc-1", "c.pdf", all_open),
            Some("main".into())
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

    fn candidate(label: &str, x: f64, width: f64, focused: u64) -> Candidate {
        Candidate {
            label: label.to_string(),
            bounds: Bounds {
                x,
                y: 0.0,
                width,
                height: 800.0,
            },
            focused,
        }
    }

    #[test]
    fn a_tab_lands_on_the_window_under_the_cursor() {
        let candidates = vec![
            candidate("main", 0.0, 1000.0, 1),
            candidate("doc-a", 1200.0, 800.0, 2),
        ];
        let picked = pick_target(1300.0, 40.0, "main", &candidates);
        assert_eq!(picked.map(|entry| entry.label.as_str()), Some("doc-a"));
        assert_eq!(pick_target(1100.0, 40.0, "doc-a", &candidates), None);
        assert_eq!(pick_target(1300.0, 900.0, "main", &candidates), None);
    }

    #[test]
    fn overlapping_windows_pick_the_one_focused_last() {
        let candidates = vec![
            candidate("main", 0.0, 1000.0, 5),
            candidate("doc-a", 100.0, 1000.0, 3),
            candidate("doc-b", 200.0, 1000.0, 9),
        ];
        let picked = pick_target(500.0, 40.0, "doc-c", &candidates);
        assert_eq!(picked.map(|entry| entry.label.as_str()), Some("doc-b"));
    }

    #[test]
    fn the_source_and_non_document_windows_are_never_targets() {
        let candidates = vec![
            candidate("main", 0.0, 1000.0, 1),
            candidate("present-1", 0.0, 1000.0, 7),
            candidate("doc-a", 0.0, 1000.0, 9),
        ];
        let picked = pick_target(500.0, 40.0, "doc-a", &candidates);
        assert_eq!(picked.map(|entry| entry.label.as_str()), Some("main"));
        assert_eq!(pick_target(500.0, 40.0, "main", &candidates[..2]), None);
    }

    #[test]
    fn focus_order_counts_up_and_a_closed_window_forgets_it() {
        let windows = DocumentWindows::default();
        windows.note_focus("main");
        windows.note_focus("doc-a");
        assert!(windows.focused_at("doc-a") > windows.focused_at("main"));
        windows.release_window("doc-a");
        assert_eq!(windows.focused_at("doc-a"), 0);
    }

    #[test]
    fn a_dropped_group_name_is_cut_to_the_tab_limit() {
        let group = trimmed_group(Some(DroppedGroup {
            name: "ş".repeat(60),
            color: "blue".to_string(),
            collapsed: false,
        }))
        .unwrap();
        assert_eq!(group.name.chars().count(), MAX_GROUP_NAME);
        assert_eq!(trimmed_group(None), None);
    }

    fn work(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_torn_off_window_opens_with_its_tab_strip_under_the_cursor() {
        let placed = placed_at_cursor(700.0, 200.0, work(0.0, 25.0, 1920.0, 1055.0));
        assert_eq!(placed, work(580.0, 182.0, WINDOW_WIDTH, WINDOW_HEIGHT));
    }

    #[test]
    fn a_window_dropped_near_an_edge_stays_on_that_screen() {
        let screen = work(1920.0, 0.0, 1440.0, 875.0);
        let placed = placed_at_cursor(3350.0, 860.0, screen);
        assert_eq!(placed, work(2080.0, 75.0, WINDOW_WIDTH, WINDOW_HEIGHT));
        let corner = placed_at_cursor(1925.0, 2.0, screen);
        assert_eq!((corner.x, corner.y), (1920.0, 0.0));
    }

    #[test]
    fn a_screen_smaller_than_the_window_shrinks_it_to_fit() {
        let placed = placed_at_cursor(400.0, 300.0, work(0.0, 0.0, 1024.0, 700.0));
        assert_eq!(placed, work(0.0, 0.0, 1024.0, 700.0));
    }

    #[test]
    fn hovering_names_the_window_to_clear_only_when_the_target_changes() {
        let windows = DocumentWindows::default();
        assert_eq!(windows.hover(Some("main")), None);
        assert_eq!(windows.hover(Some("main")), None);
        assert_eq!(windows.hover(Some("doc-a")), Some("main".to_string()));
        assert_eq!(windows.hover(None), Some("doc-a".to_string()));
        assert_eq!(windows.hover(None), None);
    }
}

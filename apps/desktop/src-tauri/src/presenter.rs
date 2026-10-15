use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::SystemTime;

use sha2::{Digest, Sha256};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::rpc::RpcError;

pub const LABEL_PREFIX: &str = "present-";
const CLOSED_EVENT: &str = "presenter-closed";
const NOTES_DIR: &str = "presenter-notes";
const CONTENT_DIR: &str = "by-content";
const MAX_HASHED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_REMEMBERED_DIGESTS: usize = 64;
const MAX_PASSWORD_CHARS: usize = 1024;
const MAX_NOTES_BYTES: usize = 1024 * 1024;
const MAX_NOTE_PAGES: usize = 5000;
const MAX_NOTE_CHARS: usize = 20_000;
const MAX_PAGE_INDEX: u32 = 1_000_000;
const NOTES_VERSION: u64 = 1;
const REHEARSAL_WIDTH: f64 = 1280.0;
const REHEARSAL_HEIGHT: f64 = 720.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Area {
    fn of(monitor: &Monitor) -> Self {
        Self {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        }
    }

    fn contains(&self, x: i64, y: i64) -> bool {
        x >= i64::from(self.x)
            && y >= i64::from(self.y)
            && x < i64::from(self.x) + i64::from(self.width)
            && y < i64::from(self.y) + i64::from(self.height)
    }

    fn surface(&self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Session {
    console: String,
    path: String,
    password: Option<String>,
    start_page: u32,
}

#[derive(Default)]
pub struct Presenters {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    console: String,
    path: String,
    password: Option<String>,
    start_page: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    label: String,
    external: bool,
    width: u32,
    height: u32,
}

impl Presenters {
    fn entries(&self) -> MutexGuard<'_, HashMap<String, Session>> {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn start(&self, audience: &str, session: Session) {
        self.entries().insert(audience.to_string(), session);
    }

    fn forget(&self, audience: &str) -> Option<Session> {
        self.entries().remove(audience)
    }

    fn view(&self, audience: &str) -> Option<SessionView> {
        self.entries().get(audience).map(|session| SessionView {
            console: session.console.clone(),
            path: session.path.clone(),
            password: session.password.clone(),
            start_page: session.start_page,
        })
    }

    fn audiences_of(&self, console: &str) -> Vec<String> {
        let mut found: Vec<String> = self
            .entries()
            .iter()
            .filter(|(_, session)| session.console == console)
            .map(|(audience, _)| audience.clone())
            .collect();
        found.sort();
        found
    }

    fn take_for_console(&self, console: &str) -> Vec<String> {
        let mut entries = self.entries();
        let mut taken: Vec<String> = entries
            .iter()
            .filter(|(_, session)| session.console == console)
            .map(|(audience, _)| audience.clone())
            .collect();
        for audience in &taken {
            entries.remove(audience);
        }
        taken.sort();
        taken
    }
}

pub fn is_audience(label: &str) -> bool {
    label.starts_with(LABEL_PREFIX)
}

fn new_label() -> String {
    format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4().simple())
}

fn index_holding(console: Area, monitors: &[Area]) -> Option<usize> {
    let centre_x = i64::from(console.x) + i64::from(console.width / 2);
    let centre_y = i64::from(console.y) + i64::from(console.height / 2);
    monitors
        .iter()
        .position(|monitor| monitor.contains(centre_x, centre_y))
        .or_else(|| monitors.iter().position(|monitor| *monitor == console))
}

pub fn pick_audience(console: Area, monitors: &[Area], primary: Option<Area>) -> Option<usize> {
    let holding = index_holding(console, monitors);
    let others: Vec<usize> = (0..monitors.len())
        .filter(|index| Some(*index) != holding)
        .collect();
    if holding.is_none() && monitors.len() < 2 {
        return None;
    }
    if let Some(primary) = primary {
        if let Some(index) = others
            .iter()
            .copied()
            .find(|index| monitors[*index] == primary)
        {
            return Some(index);
        }
    }
    others
        .into_iter()
        .max_by_key(|index| monitors[*index].surface())
}

fn internal(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("INTERNAL", error.to_string())
}

fn monitor_areas<R: Runtime>(window: &WebviewWindow<R>) -> (Option<Area>, Vec<Area>, Option<Area>) {
    let console = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| Area::of(&monitor));
    let monitors = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(Area::of)
        .collect();
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| Area::of(&monitor));
    (console, monitors, primary)
}

fn cover<R: Runtime>(window: &WebviewWindow<R>, area: Area) -> tauri::Result<()> {
    if window.is_fullscreen().unwrap_or(false) {
        window.set_fullscreen(false)?;
    }
    window.set_position(PhysicalPosition::new(area.x, area.y))?;
    window.set_size(PhysicalSize::new(area.width, area.height))?;
    window.show()?;
    window.set_fullscreen(true)
}

fn close_audiences<R: Runtime>(app: &AppHandle<R>, console: &str) {
    for audience in app.state::<Presenters>().take_for_console(console) {
        if let Some(window) = app.get_webview_window(&audience) {
            let _ = window.destroy();
        }
    }
}

pub fn end_for_console<R: Runtime>(app: &AppHandle<R>, console: &str) {
    if !is_audience(console) {
        close_audiences(app, console);
    }
}

fn granted_file(path: &str) -> Result<PathBuf, RpcError> {
    let file = PathBuf::from(path);
    if !file.is_absolute() || !file.is_file() {
        return Err(RpcError::new(
            "FILE_NOT_FOUND",
            "the document is not available",
        ));
    }
    crate::grants::check_read(&file)?;
    Ok(file)
}

#[tauri::command]
pub async fn presenter_open<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    path: String,
    password: Option<String>,
    start_page: u32,
) -> Result<Opened, RpcError> {
    if is_audience(window.label()) {
        return Err(RpcError::new(
            "INVALID_PARAMS",
            "an audience window cannot present",
        ));
    }
    if password
        .as_ref()
        .is_some_and(|value| value.chars().count() > MAX_PASSWORD_CHARS)
    {
        return Err(RpcError::new("INVALID_PARAMS", "password too long"));
    }
    granted_file(&path)?;
    close_audiences(&app, window.label());
    let (console, monitors, primary) = monitor_areas(&window);
    let target = console
        .and_then(|console| pick_audience(console, &monitors, primary))
        .map(|index| monitors[index]);
    let label = new_label();
    let presenters = app.state::<Presenters>();
    presenters.start(
        &label,
        Session {
            console: window.label().to_string(),
            path,
            password,
            start_page: start_page.min(MAX_PAGE_INDEX),
        },
    );
    let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("vivePDF")
        .visible(false)
        .focused(false)
        .decorations(target.is_none())
        .inner_size(REHEARSAL_WIDTH, REHEARSAL_HEIGHT)
        .center()
        .build();
    let audience = match built {
        Ok(audience) => audience,
        Err(error) => {
            presenters.forget(&label);
            return Err(internal(error));
        }
    };
    let handle = app.clone();
    let closing = label.clone();
    audience.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            if let Some(session) = handle.state::<Presenters>().forget(&closing) {
                let _ = handle.emit_to(session.console.as_str(), CLOSED_EVENT, closing.clone());
            }
        }
    });
    let shown = match target {
        Some(area) => cover(&audience, area),
        None => audience.show(),
    };
    if let Err(error) = shown {
        presenters.forget(&label);
        let _ = audience.destroy();
        return Err(internal(error));
    }
    let size = match target {
        Some(area) => PhysicalSize::new(area.width, area.height),
        None => audience.inner_size().unwrap_or(PhysicalSize::new(
            REHEARSAL_WIDTH as u32,
            REHEARSAL_HEIGHT as u32,
        )),
    };
    Ok(Opened {
        label,
        external: target.is_some(),
        width: size.width,
        height: size.height,
    })
}

#[tauri::command]
pub fn presenter_session<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Option<SessionView> {
    if !is_audience(window.label()) {
        return None;
    }
    app.state::<Presenters>().view(window.label())
}

#[tauri::command]
pub fn presenter_close<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) {
    end_for_console(&app, window.label());
}

#[tauri::command]
pub async fn presenter_swap<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Opened, RpcError> {
    let audience_label = app
        .state::<Presenters>()
        .audiences_of(window.label())
        .into_iter()
        .next()
        .ok_or_else(|| RpcError::new("INVALID_PARAMS", "nothing is being presented"))?;
    let audience = app
        .get_webview_window(&audience_label)
        .ok_or_else(|| RpcError::new("INVALID_PARAMS", "the audience window is gone"))?;
    let (console, monitors, _) = monitor_areas(&window);
    let screen = audience
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| Area::of(&monitor));
    let (Some(console), Some(screen)) = (console, screen) else {
        return Err(RpcError::new("INVALID_PARAMS", "no second screen"));
    };
    let console_index = index_holding(console, &monitors);
    let screen_index = index_holding(screen, &monitors);
    if monitors.len() < 2 || console_index == screen_index {
        return Err(RpcError::new("INVALID_PARAMS", "no second screen"));
    }
    cover(&audience, console).map_err(internal)?;
    cover(&window, screen).map_err(internal)?;
    let _ = window.set_focus();
    Ok(Opened {
        label: audience_label,
        external: true,
        width: console.width,
        height: console.height,
    })
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn notes_file_name(path: &str) -> String {
    let digest = Sha256::digest(crate::document_windows::claim_key(path).as_bytes());
    format!("{}.json", hex(&digest))
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
}

impl Stamp {
    fn of(file: &Path) -> Option<Self> {
        let metadata = std::fs::metadata(file).ok()?;
        metadata.is_file().then(|| Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
        })
    }
}

type Digests = HashMap<PathBuf, (Stamp, String)>;

fn remembered_digests() -> MutexGuard<'static, Digests> {
    static DIGESTS: OnceLock<Mutex<Digests>> = OnceLock::new();
    DIGESTS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn content_digest(file: &Path, limit: u64) -> Option<String> {
    let stamp = Stamp::of(file).filter(|stamp| stamp.len <= limit)?;
    if let Some((known, digest)) = remembered_digests().get(file) {
        if *known == stamp {
            return Some(digest.clone());
        }
    }
    let mut reader = std::fs::File::open(file).ok()?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut reader, &mut hasher).ok()?;
    let digest = hex(&hasher.finalize());
    if Stamp::of(file) != Some(stamp) {
        return None;
    }
    let mut digests = remembered_digests();
    if digests.len() >= MAX_REMEMBERED_DIGESTS {
        digests.clear();
    }
    digests.insert(file.to_path_buf(), (stamp, digest.clone()));
    Some(digest)
}

struct NotesFiles {
    document: PathBuf,
    by_path: PathBuf,
    by_content: PathBuf,
}

impl NotesFiles {
    fn content_file(&self, limit: u64) -> Option<PathBuf> {
        content_digest(&self.document, limit)
            .map(|digest| self.by_content.join(format!("{digest}.json")))
    }

    fn read(&self, limit: u64) -> Result<Option<String>, RpcError> {
        if let Some(text) = read_notes(&self.by_path)? {
            return Ok(Some(text));
        }
        match self.content_file(limit) {
            Some(file) => read_notes(&file),
            None => Ok(None),
        }
    }

    fn write(&self, contents: Option<&str>, limit: u64) -> Result<(), RpcError> {
        write_notes(&self.by_path, contents)?;
        match self.content_file(limit) {
            Some(file) => write_notes(&file, contents),
            None => Ok(()),
        }
    }
}

fn invalid(message: &str) -> RpcError {
    RpcError::new("INVALID_PARAMS", message)
}

pub fn validate_notes(contents: &str) -> Result<(), RpcError> {
    if contents.len() > MAX_NOTES_BYTES {
        return Err(invalid("notes too large"));
    }
    let value: serde_json::Value =
        serde_json::from_str(contents).map_err(|error| invalid(&error.to_string()))?;
    if value.get("version").and_then(serde_json::Value::as_u64) != Some(NOTES_VERSION) {
        return Err(invalid("unknown notes version"));
    }
    let notes = value
        .get("notes")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| invalid("notes missing"))?;
    if notes.len() > MAX_NOTE_PAGES {
        return Err(invalid("too many notes"));
    }
    for (page, note) in notes {
        let index: u32 = page.parse().map_err(|_| invalid("bad page index"))?;
        if index > MAX_PAGE_INDEX || page != &index.to_string() {
            return Err(invalid("bad page index"));
        }
        let text = note
            .as_str()
            .ok_or_else(|| invalid("a note must be text"))?;
        if text.chars().count() > MAX_NOTE_CHARS {
            return Err(invalid("note too long"));
        }
    }
    Ok(())
}

fn read_notes(file: &Path) -> Result<Option<String>, RpcError> {
    match std::fs::read_to_string(file) {
        Ok(text) if validate_notes(&text).is_ok() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(internal(error)),
    }
}

fn write_notes(file: &Path, contents: Option<&str>) -> Result<(), RpcError> {
    let Some(contents) = contents else {
        return match std::fs::remove_file(file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(internal(error)),
            _ => Ok(()),
        };
    };
    validate_notes(contents)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(internal)?;
    }
    let staging = file.with_extension("json.tmp");
    std::fs::write(&staging, contents).map_err(internal)?;
    std::fs::rename(&staging, file).map_err(|error| {
        let _ = std::fs::remove_file(&staging);
        internal(error)
    })
}

fn notes_files<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<NotesFiles, RpcError> {
    let document = granted_file(path)?;
    let dir = app.path().app_data_dir().map_err(internal)?.join(NOTES_DIR);
    Ok(NotesFiles {
        document,
        by_path: dir.join(notes_file_name(path)),
        by_content: dir.join(CONTENT_DIR),
    })
}

#[tauri::command]
pub async fn presenter_notes_read<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Option<String>, RpcError> {
    let files = notes_files(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || files.read(MAX_HASHED_BYTES))
        .await
        .map_err(internal)?
}

#[tauri::command]
pub async fn presenter_notes_write<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    contents: Option<String>,
) -> Result<(), RpcError> {
    let files = notes_files(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || files.write(contents.as_deref(), MAX_HASHED_BYTES))
        .await
        .map_err(internal)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(x: i32, y: i32, width: u32, height: u32) -> Area {
        Area {
            x,
            y,
            width,
            height,
        }
    }

    fn session(console: &str) -> Session {
        Session {
            console: console.to_string(),
            path: "C:/a.pdf".to_string(),
            password: Some("secret".to_string()),
            start_page: 3,
        }
    }

    #[test]
    fn labels_match_the_capability_pattern() {
        let label = new_label();
        let suffix = label.strip_prefix("present-").unwrap();
        assert_eq!(suffix.len(), 32);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(is_audience(&label));
        assert!(!is_audience("main"));
        assert!(!is_audience("doc-1"));
    }

    #[test]
    fn one_monitor_has_no_audience_screen() {
        let laptop = area(0, 0, 1920, 1080);
        assert_eq!(pick_audience(laptop, &[laptop], Some(laptop)), None);
        assert_eq!(pick_audience(laptop, &[], None), None);
    }

    #[test]
    fn the_other_monitor_takes_the_audience() {
        let laptop = area(0, 0, 1920, 1080);
        let projector = area(1920, 0, 1280, 720);
        assert_eq!(
            pick_audience(laptop, &[laptop, projector], Some(laptop)),
            Some(1)
        );
        assert_eq!(
            pick_audience(projector, &[laptop, projector], Some(laptop)),
            Some(0)
        );
    }

    #[test]
    fn three_monitors_prefer_the_primary_then_the_largest() {
        let laptop = area(0, 0, 1920, 1080);
        let small = area(-1280, 0, 1280, 720);
        let large = area(1920, 0, 3840, 2160);
        let monitors = [laptop, small, large];
        assert_eq!(pick_audience(laptop, &monitors, Some(small)), Some(1));
        assert_eq!(pick_audience(laptop, &monitors, Some(laptop)), Some(2));
        assert_eq!(pick_audience(laptop, &monitors, None), Some(2));
    }

    #[test]
    fn a_console_window_smaller_than_its_monitor_is_found_by_its_centre() {
        let laptop = area(0, 0, 1920, 1080);
        let projector = area(1920, 0, 1920, 1080);
        let window = area(2000, 100, 800, 600);
        assert_eq!(
            pick_audience(window, &[laptop, projector], Some(laptop)),
            Some(0)
        );
    }

    #[test]
    fn a_session_is_read_only_by_its_audience_and_forgotten() {
        let presenters = Presenters::default();
        presenters.start("present-a", session("main"));
        assert_eq!(
            presenters.view("present-a").unwrap().password.as_deref(),
            Some("secret")
        );
        assert_eq!(presenters.view("present-b"), None);
        assert!(presenters.forget("present-a").is_some());
        assert_eq!(presenters.view("present-a"), None);
        assert!(presenters.forget("present-a").is_none());
    }

    #[test]
    fn a_closing_console_takes_only_its_own_audiences() {
        let presenters = Presenters::default();
        presenters.start("present-a", session("main"));
        presenters.start("present-b", session("doc-1"));
        assert_eq!(presenters.audiences_of("main"), vec!["present-a"]);
        assert_eq!(presenters.take_for_console("main"), vec!["present-a"]);
        assert_eq!(presenters.view("present-a"), None);
        assert!(presenters.view("present-b").is_some());
        assert!(presenters.take_for_console("main").is_empty());
    }

    #[test]
    fn notes_file_names_are_stable_hashes() {
        let directory = std::env::temp_dir().join("vivepdf-notes-name-test");
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("Talk.pdf");
        std::fs::write(&file, b"%PDF-1.4").unwrap();
        let name = notes_file_name(&file.to_string_lossy());
        let dotted = directory.join(".").join("Talk.pdf");
        assert_eq!(notes_file_name(&dotted.to_string_lossy()), name);
        assert_eq!(name.len(), 64 + ".json".len());
        assert!(name
            .trim_end_matches(".json")
            .chars()
            .all(|c| c.is_ascii_hexdigit()));
        assert_ne!(notes_file_name("../../etc/passwd"), name);
        assert!(!notes_file_name("../../etc/passwd").contains('/'));
    }

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("vivepdf-notes-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join(NOTES_DIR).join("notes.json")
    }

    #[test]
    fn notes_round_trip_atomically_and_clear() {
        let file = scratch("roundtrip");
        let notes =
            r#"{"version":1,"pageCount":3,"updatedAt":1,"notes":{"0":"Merhaba ş","2":"Son"}}"#;
        write_notes(&file, Some(notes)).unwrap();
        assert_eq!(read_notes(&file).unwrap().as_deref(), Some(notes));
        assert!(!file.with_extension("json.tmp").exists());
        write_notes(&file, None).unwrap();
        assert!(!file.exists());
        assert_eq!(read_notes(&file).unwrap(), None);
        write_notes(&file, None).unwrap();
        let _ = std::fs::remove_dir_all(file.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn invalid_notes_are_refused_and_keep_the_old_file() {
        let file = scratch("refuse");
        let good = r#"{"version":1,"notes":{"1":"a"}}"#;
        write_notes(&file, Some(good)).unwrap();
        let long = format!(
            r#"{{"version":1,"notes":{{"0":"{}"}}}}"#,
            "a".repeat(MAX_NOTE_CHARS + 1)
        );
        let many = format!(
            r#"{{"version":1,"notes":{{{}}}}}"#,
            (0..=MAX_NOTE_PAGES)
                .map(|page| format!(r#""{page}":"""#))
                .collect::<Vec<_>>()
                .join(",")
        );
        for bad in [
            "not json",
            r#"{"version":2,"notes":{}}"#,
            r#"{"version":1}"#,
            r#"{"version":1,"notes":{"x":"a"}}"#,
            r#"{"version":1,"notes":{"01":"a"}}"#,
            r#"{"version":1,"notes":{"1":5}}"#,
            long.as_str(),
            many.as_str(),
        ] {
            assert_eq!(
                write_notes(&file, Some(bad)).unwrap_err().code,
                "INVALID_PARAMS"
            );
        }
        let huge = format!(
            r#"{{"version":1,"notes":{{}},"x":"{}"}}"#,
            "a".repeat(MAX_NOTES_BYTES)
        );
        assert_eq!(
            write_notes(&file, Some(&huge)).unwrap_err().code,
            "INVALID_PARAMS"
        );
        assert_eq!(read_notes(&file).unwrap().as_deref(), Some(good));
        let _ = std::fs::remove_dir_all(file.parent().unwrap().parent().unwrap());
    }

    fn library(label: &str) -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("vivepdf-notes-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let documents = root.join("documents");
        std::fs::create_dir_all(&documents).unwrap();
        (root, documents)
    }

    fn files_for(root: &Path, document: &Path) -> NotesFiles {
        let dir = root.join(NOTES_DIR);
        NotesFiles {
            document: document.to_path_buf(),
            by_path: dir.join(notes_file_name(&document.to_string_lossy())),
            by_content: dir.join(CONTENT_DIR),
        }
    }

    const NOTES: &str = r#"{"version":1,"notes":{"0":"Giriş"}}"#;

    #[test]
    fn notes_follow_a_renamed_moved_or_copied_file() {
        let (root, documents) = library("follow");
        let original = documents.join("Talk.pdf");
        std::fs::write(&original, b"%PDF-1.7 talk").unwrap();
        files_for(&root, &original)
            .write(Some(NOTES), 1024)
            .unwrap();
        let renamed = documents.join("Renamed.pdf");
        std::fs::rename(&original, &renamed).unwrap();
        let copied = root.join("Copied.pdf");
        std::fs::copy(&renamed, &copied).unwrap();

        let after_rename = files_for(&root, &renamed).read(1024).unwrap();
        let after_copy = files_for(&root, &copied).read(1024).unwrap();

        assert_eq!(after_rename.as_deref(), Some(NOTES));
        assert_eq!(after_copy.as_deref(), Some(NOTES));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_edited_and_moved_file_starts_empty_but_keeps_notes_in_place() {
        let (root, documents) = library("edited");
        let talk = documents.join("Talk.pdf");
        std::fs::write(&talk, b"%PDF-1.7 first").unwrap();
        files_for(&root, &talk).write(Some(NOTES), 1024).unwrap();
        std::fs::write(&talk, b"%PDF-1.7 second edition").unwrap();
        let moved = root.join("Moved.pdf");
        std::fs::copy(&talk, &moved).unwrap();

        let in_place = files_for(&root, &talk).read(1024).unwrap();
        let elsewhere = files_for(&root, &moved).read(1024).unwrap();

        assert_eq!(in_place.as_deref(), Some(NOTES));
        assert_eq!(elsewhere, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_path_notes_win_over_the_content_notes_and_clearing_removes_both() {
        let (root, documents) = library("order");
        let first = documents.join("A.pdf");
        let copy = documents.join("B.pdf");
        std::fs::write(&first, b"%PDF-1.7 same").unwrap();
        std::fs::write(&copy, b"%PDF-1.7 same").unwrap();
        let own = r#"{"version":1,"notes":{"1":"B only"}}"#;
        files_for(&root, &first).write(Some(NOTES), 1024).unwrap();
        files_for(&root, &copy).write(Some(own), 1024).unwrap();

        let first_reads = files_for(&root, &first).read(1024).unwrap();
        files_for(&root, &copy).write(None, 1024).unwrap();
        let cleared = files_for(&root, &copy).read(1024).unwrap();

        assert_eq!(first_reads.as_deref(), Some(NOTES));
        assert_eq!(cleared, None);
        assert_eq!(
            files_for(&root, &first).read(1024).unwrap().as_deref(),
            Some(NOTES)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn content_digests_track_the_bytes_and_skip_large_or_missing_files() {
        let (root, documents) = library("digest");
        let file = documents.join("Talk.pdf");
        std::fs::write(&file, b"%PDF-1.7 one").unwrap();
        let twin = documents.join("Twin.pdf");
        std::fs::write(&twin, b"%PDF-1.7 one").unwrap();

        let before = content_digest(&file, 1024).unwrap();
        std::fs::write(&file, b"%PDF-1.7 a longer second version").unwrap();
        let after = content_digest(&file, 1024).unwrap();

        assert_eq!(
            content_digest(&twin, 1024).as_deref(),
            Some(before.as_str())
        );
        assert_ne!(before, after);
        assert_eq!(before.len(), 64);
        assert_eq!(content_digest(&file, 8), None);
        assert_eq!(content_digest(&documents.join("missing.pdf"), 1024), None);
        assert_eq!(content_digest(&documents, 1024), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_over_the_hash_limit_keeps_its_path_notes_only() {
        let (root, documents) = library("limit");
        let talk = documents.join("Talk.pdf");
        std::fs::write(&talk, b"%PDF-1.7 big").unwrap();
        let files = files_for(&root, &talk);

        files.write(Some(NOTES), 4).unwrap();

        assert_eq!(files.read(4).unwrap().as_deref(), Some(NOTES));
        assert!(!files.by_content.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_tampered_notes_file_reads_as_empty() {
        let file = scratch("tampered");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, r#"{"version":9}"#).unwrap();
        assert_eq!(read_notes(&file).unwrap(), None);
        let _ = std::fs::remove_dir_all(file.parent().unwrap().parent().unwrap());
    }
}

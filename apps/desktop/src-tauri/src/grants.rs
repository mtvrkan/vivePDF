use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Manager, Runtime, WebviewWindow};

use crate::document_windows::MAIN_WINDOW;
use crate::rpc::RpcError;
use crate::write_guard::{comparable, resolved};

const GRANTS_FILE_NAME: &str = "grants.json";
const GRANTS_VERSION: u32 = 3;
const PREVIOUS_VERSION: u32 = 2;
const LEGACY_VERSION: u32 = 1;
const ADOPT_ROUND: u32 = 2;
const FILE_KEEP: usize = 2000;
const FOLDER_KEEP: usize = 200;
const ADOPT_LIMIT: usize = 1000;
const ADOPTABLE_EXTRA_EXTENSIONS: [&str; 20] = [
    "markdown",
    "xps",
    "oxps",
    "mobi",
    "fb2",
    "cbz",
    "eml",
    "msg",
    "avif",
    "pnm",
    "pgm",
    "ppm",
    "heic",
    "heif",
    "hif",
    "vivedoc",
    "vivedesign",
    "bib",
    "bibtex",
    "ris",
];
const LINUX_SYSTEM_DIRS: [&str; 12] = [
    "/etc", "/usr", "/bin", "/sbin", "/boot", "/proc", "/sys", "/dev", "/run", "/var", "/root",
    "/opt",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum FolderMode {
    ReadWrite,
    Write,
}

#[derive(Serialize, Deserialize)]
struct StoredFolder {
    path: String,
    mode: FolderMode,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    version: u32,
    adopted_round: u32,
    files: Vec<String>,
    #[serde(default)]
    read_files: Vec<String>,
    folders: Vec<StoredFolder>,
}

#[derive(Deserialize)]
struct Legacy {
    version: u32,
    adopted: bool,
    files: Vec<String>,
    folders: Vec<String>,
}

#[derive(Default)]
struct Recent {
    order: VecDeque<String>,
}

impl Recent {
    fn from_keys(keys: Vec<String>, keep: usize) -> Self {
        let mut recent = Self::default();
        for key in keys {
            recent.touch(key, keep);
        }
        recent
    }

    fn touch(&mut self, key: String, keep: usize) -> bool {
        let known = match self.order.iter().position(|item| *item == key) {
            Some(index) => {
                self.order.remove(index);
                true
            }
            None => false,
        };
        self.order.push_back(key);
        while self.order.len() > keep {
            self.order.pop_front();
        }
        !known
    }

    fn contains(&self, key: &str) -> bool {
        self.order.iter().any(|item| item == key)
    }

    fn remove(&mut self, key: &str) -> bool {
        let before = self.order.len();
        self.order.retain(|item| item != key);
        self.order.len() != before
    }

    fn keys(&self) -> Vec<String> {
        self.order.iter().cloned().collect()
    }
}

#[derive(Default)]
struct Registry {
    files: Recent,
    read_files: Recent,
    folders: Recent,
    write_folders: Recent,
    adopted_round: u32,
    read_roots: Vec<String>,
    write_roots: Vec<String>,
    create_roots: Vec<String>,
    store: Option<PathBuf>,
}

pub(crate) fn key_of(path: &Path) -> String {
    comparable(&resolved(path))
        .trim_end_matches('/')
        .to_string()
}

pub(crate) fn inside(key: &str, base: &str) -> bool {
    key == base
        || key
            .strip_prefix(base)
            .is_some_and(|rest| rest.starts_with('/'))
}

pub(crate) fn parent_key(key: &str) -> Option<&str> {
    key.rsplit_once('/').map(|(parent, _)| parent)
}

fn below<'a>(key: &'a str, base: &str) -> Option<&'a str> {
    if key == base {
        return Some("");
    }
    key.strip_prefix(base)?.strip_prefix('/')
}

fn plain_segments(rest: &str) -> bool {
    rest.split('/')
        .all(|segment| segment.is_empty() || !segment.starts_with('.'))
}

fn readable_below(path: &Path, rest: &str) -> bool {
    plain_segments(rest)
        && (rest.is_empty() || path.is_dir() || crate::files::is_openable_output(path))
}

impl Registry {
    fn load(&mut self, text: &str) {
        if let Ok(stored) = serde_json::from_str::<Stored>(text) {
            if stored.version != GRANTS_VERSION && stored.version != PREVIOUS_VERSION {
                return;
            }
            self.files = Recent::from_keys(stored.files, FILE_KEEP);
            self.read_files = Recent::from_keys(stored.read_files, FILE_KEEP);
            for folder in stored.folders {
                let target = match folder.mode {
                    FolderMode::ReadWrite => &mut self.folders,
                    FolderMode::Write => &mut self.write_folders,
                };
                target.touch(folder.path, FOLDER_KEEP);
            }
            self.adopted_round = stored.adopted_round;
            return;
        }
        let Ok(legacy) = serde_json::from_str::<Legacy>(text) else {
            return;
        };
        if legacy.version != LEGACY_VERSION {
            return;
        }
        self.files = Recent::from_keys(legacy.files, FILE_KEEP);
        self.write_folders = Recent::from_keys(legacy.folders, FOLDER_KEEP);
        self.adopted_round = u32::from(legacy.adopted);
    }

    fn snapshot(&self) -> Stored {
        let write_only = self
            .write_folders
            .keys()
            .into_iter()
            .map(|path| StoredFolder {
                path,
                mode: FolderMode::Write,
            });
        let read_write = self.folders.keys().into_iter().map(|path| StoredFolder {
            path,
            mode: FolderMode::ReadWrite,
        });
        Stored {
            version: GRANTS_VERSION,
            adopted_round: self.adopted_round,
            files: self.files.keys(),
            read_files: self.read_files.keys(),
            folders: write_only.chain(read_write).collect(),
        }
    }

    fn allow(&mut self, path: &Path, mode: FolderMode) -> bool {
        let key = key_of(path);
        if key.is_empty() {
            return false;
        }
        if !path.is_dir() {
            let promoted = self.read_files.remove(&key);
            return self.files.touch(key, FILE_KEEP) || promoted;
        }
        match mode {
            FolderMode::ReadWrite => {
                let promoted = self.write_folders.remove(&key);
                self.folders.touch(key, FOLDER_KEEP) || promoted
            }
            FolderMode::Write if self.folders.contains(&key) => {
                self.folders.touch(key, FOLDER_KEEP)
            }
            FolderMode::Write => self.write_folders.touch(key, FOLDER_KEEP),
        }
    }

    fn may_read(&mut self, path: &Path) -> bool {
        let key = key_of(path);
        if self.files.contains(&key) {
            self.files.touch(key, FILE_KEEP);
            return true;
        }
        if self.read_files.contains(&key) {
            self.read_files.touch(key, FILE_KEEP);
            return true;
        }
        self.read_roots.iter().any(|root| inside(&key, root))
            || self
                .folders
                .order
                .iter()
                .filter_map(|folder| below(&key, folder))
                .any(|rest| readable_below(path, rest))
    }

    fn creates_new(&self, key: &str, path: &Path) -> bool {
        !path.exists()
            && self
                .create_roots
                .iter()
                .filter_map(|root| below(key, root))
                .any(|rest| !rest.is_empty() && plain_segments(rest))
    }

    fn grant_new_folder(&mut self, path: &Path) -> bool {
        let key = key_of(path);
        if !self.creates_new(&key, path) {
            return false;
        }
        self.write_folders.touch(key, FOLDER_KEEP);
        true
    }

    fn may_write(&mut self, path: &Path) -> bool {
        let key = key_of(path);
        if self.files.contains(&key) || self.write_roots.iter().any(|root| inside(&key, root)) {
            return true;
        }
        let in_folder = self
            .folders
            .order
            .iter()
            .chain(self.write_folders.order.iter())
            .filter_map(|folder| below(&key, folder))
            .any(plain_segments);
        if in_folder {
            return true;
        }
        if self.creates_new(&key, path) {
            return true;
        }
        let Some((parent, name)) = key.rsplit_once('/') else {
            return false;
        };
        let beside = |list: &Recent| {
            list.order
                .iter()
                .any(|file| parent_key(file) == Some(parent))
        };
        !name.starts_with('.')
            && (beside(&self.files) || (!path.exists() && beside(&self.read_files)))
    }

    fn network_keys(&self) -> impl Iterator<Item = String> + '_ {
        self.files
            .order
            .iter()
            .chain(self.read_files.order.iter())
            .chain(self.folders.order.iter())
            .chain(self.write_folders.order.iter())
            .filter_map(|key| network_form(key))
    }

    fn reaches_network_unasked(&self, path: &Path) -> bool {
        let Some(key) = network_path_key(path) else {
            return false;
        };
        if key.is_empty() {
            return true;
        }
        !self.network_keys().any(|grant| {
            inside(&key, &grant)
                || parent_key(&key).is_some_and(|parent| parent_key(&grant) == Some(parent))
        })
    }
}

fn network_form(key: &str) -> Option<String> {
    if let Some(rest) = key.strip_prefix("//?/unc/") {
        return Some(format!("//{rest}"));
    }
    if key.starts_with("//?/") || key.starts_with("//./") {
        return None;
    }
    key.starts_with("//").then(|| key.to_string())
}

fn network_path_key(path: &Path) -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    let text = path.to_string_lossy().replace('\\', "/");
    if !text.starts_with("//") {
        return None;
    }
    if text.starts_with("//./") || text.eq_ignore_ascii_case("//.") {
        return Some(String::new());
    }
    let lower = text.to_lowercase();
    if lower.starts_with("//?/") && !lower.starts_with("//?/unc/") {
        return None;
    }
    let plain = lower
        .strip_prefix("//?/unc/")
        .map_or(lower.clone(), |rest| format!("//{rest}"));
    let mut parts: Vec<&str> = Vec::new();
    for part in plain.trim_start_matches('/').split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.len() <= 2 {
                    return Some(String::new());
                }
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    if parts.len() < 2 {
        return Some(String::new());
    }
    Some(format!("//{}", parts.join("/")))
}

fn lexically_adoptable(text: &str) -> bool {
    if text.is_empty() || text.contains('\0') {
        return false;
    }
    let slashed = text.replace('\\', "/");
    if slashed.starts_with("//") {
        return false;
    }
    let path = Path::new(text);
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return false;
    }
    if cfg!(windows) {
        let bytes = slashed.as_bytes();
        let drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
        if !drive || slashed[2..].contains(':') {
            return false;
        }
    }
    true
}

fn adoptable_extension(path: &Path) -> bool {
    if crate::files::is_openable_output(path) {
        return true;
    }
    path.extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .is_some_and(|ext| ADOPTABLE_EXTRA_EXTENSIONS.contains(&ext.as_str()))
}

#[derive(Default)]
struct AdoptLimits {
    denied: Vec<String>,
    allowed: Vec<String>,
}

impl AdoptLimits {
    fn from_dirs(denied: &[PathBuf], allowed: &[PathBuf]) -> Self {
        Self {
            denied: root_keys(denied),
            allowed: root_keys(allowed),
        }
    }

    fn denies(&self, key: &str) -> bool {
        if key
            .split('/')
            .skip(1)
            .any(|segment| segment.starts_with('.'))
        {
            return true;
        }
        if self.allowed.iter().any(|base| inside(key, base)) {
            return false;
        }
        self.denied.iter().any(|base| inside(key, base))
    }
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn adopt_limits() -> AdoptLimits {
    let mut denied = crate::write_guard::protected_dirs();
    let mut allowed = Vec::new();
    if cfg!(windows) {
        denied.extend(
            [
                "APPDATA",
                "LOCALAPPDATA",
                "PROGRAMDATA",
                "ProgramFiles",
                "ProgramFiles(x86)",
                "WINDIR",
            ]
            .iter()
            .filter_map(|name| env_path(name)),
        );
        denied.extend(env_path("USERPROFILE").map(|home| home.join("AppData")));
    }
    if cfg!(target_os = "macos") {
        if let Some(home) = env_path("HOME") {
            let library = home.join("Library");
            allowed.push(library.join("Mobile Documents"));
            allowed.push(library.join("CloudStorage"));
            denied.push(library);
        }
    }
    if cfg!(all(unix, not(target_os = "macos"))) {
        denied.extend(LINUX_SYSTEM_DIRS.iter().map(PathBuf::from));
        denied.extend(
            [
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
                "XDG_CACHE_HOME",
            ]
            .iter()
            .filter_map(|name| env_path(name)),
        );
    }
    AdoptLimits::from_dirs(&denied, &allowed)
}

fn registry() -> MutexGuard<'static, Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| Mutex::new(Registry::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn persist(registry: &Registry) {
    let Some(path) = &registry.store else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(&registry.snapshot()) {
        let _ = std::fs::write(path, text);
    }
}

fn root_keys(dirs: &[PathBuf]) -> Vec<String> {
    dirs.iter()
        .map(|dir| key_of(dir))
        .filter(|key| !key.is_empty())
        .collect()
}

fn e2e_roots() -> Vec<PathBuf> {
    if !crate::e2e::active() {
        return Vec::new();
    }
    std::env::var_os("VIVEPDF_E2E_RUN_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .into_iter()
        .collect()
}

pub fn install<R: Runtime>(app: &tauri::AppHandle<R>) {
    let resolver = app.path();
    let app_dirs: Vec<PathBuf> = [
        resolver.app_data_dir(),
        resolver.app_local_data_dir(),
        resolver.app_cache_dir(),
    ]
    .into_iter()
    .filter_map(Result::ok)
    .chain(crate::font_source::data_dir(|name| {
        std::env::var(name).ok()
    }))
    .collect();
    crate::write_guard::protect_app_dirs(app_dirs.clone());
    let mut read_dirs = app_dirs.clone();
    read_dirs.push(std::env::temp_dir());
    read_dirs.extend(e2e_roots());
    let mut write_dirs = vec![std::env::temp_dir()];
    write_dirs.extend(e2e_roots());
    let create_dirs: Vec<PathBuf> = resolver.document_dir().into_iter().collect();
    let store = resolver
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(GRANTS_FILE_NAME));
    {
        let mut registry = registry();
        if let Some(text) = store
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
        {
            registry.load(&text);
        }
        registry.read_roots = root_keys(&read_dirs);
        registry.write_roots = root_keys(&write_dirs);
        registry.create_roots = root_keys(&create_dirs);
        registry.store = store;
    }
    use tauri_plugin_fs::FsExt;
    if let Some(scope) = app.try_fs_scope() {
        scope.listen(|event| {
            let tauri::scope::fs::Event::PathAllowed(path) = event else {
                return;
            };
            allow_dialog_pick(path);
        });
    }
}

fn allow_all<P: AsRef<Path>>(paths: &[P], mode: FolderMode) {
    let mut registry = registry();
    let mut changed = false;
    for path in paths {
        changed |= registry.allow(path.as_ref(), mode);
    }
    if changed {
        persist(&registry);
    }
}

pub fn allow_path(path: &Path) {
    allow_all(&[path], FolderMode::ReadWrite);
}

pub fn allow_paths<S: AsRef<str>>(paths: &[S]) {
    let paths: Vec<&Path> = paths.iter().map(|path| Path::new(path.as_ref())).collect();
    allow_all(&paths, FolderMode::ReadWrite);
}

fn allow_dialog_pick(path: &Path) {
    allow_all(&[path], FolderMode::Write);
}

#[cfg(any(test, feature = "e2e"))]
fn answer_paths(answer: &serde_json::Value) -> Vec<PathBuf> {
    match answer {
        serde_json::Value::String(path) => vec![PathBuf::from(path)],
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(PathBuf::from)
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(any(test, feature = "e2e"))]
pub fn allow_answer(answer: &serde_json::Value) {
    for path in answer_paths(answer) {
        allow_dialog_pick(&path);
    }
}

fn not_granted(path: &Path) -> RpcError {
    RpcError {
        code: "PERMISSION_DENIED".to_string(),
        message: format!("{} was not opened through vivePDF", path.display()),
        data: Some(json!({ "reason": "notGranted" })),
    }
}

pub fn check_read(path: &Path) -> Result<(), RpcError> {
    let mut registry = registry();
    if registry.reaches_network_unasked(path) {
        return Err(not_granted(path));
    }
    if registry.may_read(path) {
        return Ok(());
    }
    drop(registry);
    if crate::files::was_produced(path) {
        return Ok(());
    }
    Err(not_granted(path))
}

pub fn check_write(path: &Path) -> Result<(), RpcError> {
    let mut registry = registry();
    if registry.reaches_network_unasked(path) {
        return Err(not_granted(path));
    }
    if registry.may_write(path) {
        return Ok(());
    }
    drop(registry);
    if crate::files::was_produced(path) {
        return Ok(());
    }
    Err(not_granted(path))
}

pub fn check_write_folder(path: &Path) -> Result<(), RpcError> {
    let mut registry = registry();
    if registry.reaches_network_unasked(path) {
        return Err(not_granted(path));
    }
    if registry.grant_new_folder(path) {
        persist(&registry);
        return Ok(());
    }
    if registry.may_write(path) || crate::files::was_produced(path) {
        return Ok(());
    }
    Err(not_granted(path))
}

pub fn is_known(path: &Path) -> bool {
    let mut registry = registry();
    if registry.reaches_network_unasked(path) {
        return false;
    }
    if registry.may_read(path) || registry.may_write(path) {
        return true;
    }
    drop(registry);
    crate::files::was_produced(path)
}

pub fn inside_roots(path: &Path) -> bool {
    let key = key_of(path);
    let registry = registry();
    registry
        .read_roots
        .iter()
        .chain(registry.write_roots.iter())
        .any(|root| inside(&key, root))
}

fn home_dir() -> Option<PathBuf> {
    ["HOME", "USERPROFILE"]
        .iter()
        .filter_map(std::env::var_os)
        .find(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn adoptable_folder(text: &str, home: Option<&Path>, limits: &AdoptLimits) -> bool {
    if !lexically_adoptable(text) {
        return false;
    }
    let path = Path::new(text);
    if !path.is_dir() || path.parent().is_none() || crate::watch_paths::is_protected_root(path) {
        return false;
    }
    let key = key_of(path);
    if key.is_empty() || !key.contains('/') || limits.denies(&key) {
        return false;
    }
    home.is_none_or(|home| !inside(&key_of(home), &key))
}

fn adoptable_file(text: &str, limits: &AdoptLimits) -> Option<String> {
    if !lexically_adoptable(text) {
        return None;
    }
    let path = Path::new(text);
    if !adoptable_extension(path) || !path.is_file() || crate::watch_paths::is_protected_root(path)
    {
        return None;
    }
    let key = key_of(path);
    (!key.is_empty() && !limits.denies(&key)).then_some(key)
}

impl Registry {
    fn adopt(
        &mut self,
        files: &[String],
        read_folders: &[String],
        write_folders: &[String],
        home: Option<&Path>,
        limits: &AdoptLimits,
    ) -> usize {
        let mut adopted = 0;
        for text in files.iter().take(ADOPT_LIMIT) {
            let Some(key) = adoptable_file(text, limits) else {
                continue;
            };
            if !self.files.contains(&key) && self.read_files.touch(key, FILE_KEEP) {
                adopted += 1;
            }
        }
        for (folders, mode) in [
            (read_folders, FolderMode::ReadWrite),
            (write_folders, FolderMode::Write),
        ] {
            for text in folders.iter().take(FOLDER_KEEP) {
                if adoptable_folder(text, home, limits) && self.allow(Path::new(text), mode) {
                    adopted += 1;
                }
            }
        }
        self.adopted_round = ADOPT_ROUND;
        adopted
    }
}

pub fn adopt_engine_folders<S: AsRef<str>>(folders: &[S]) {
    let home = home_dir();
    let limits = adopt_limits();
    let picked: Vec<&Path> = folders
        .iter()
        .map(AsRef::as_ref)
        .filter(|text| adoptable_folder(text, home.as_deref(), &limits))
        .map(Path::new)
        .collect();
    allow_all(&picked, FolderMode::ReadWrite);
}

#[tauri::command]
pub fn grants_adopt<R: Runtime>(
    window: WebviewWindow<R>,
    paths: Vec<String>,
    read_folders: Option<Vec<String>>,
    write_folders: Option<Vec<String>>,
) -> usize {
    if window.label() != MAIN_WINDOW {
        return 0;
    }
    let mut registry = registry();
    if registry.adopted_round >= ADOPT_ROUND {
        return 0;
    }
    let adopted = registry.adopt(
        &paths,
        &read_folders.unwrap_or_default(),
        &write_folders.unwrap_or_default(),
        home_dir().as_deref(),
        &adopt_limits(),
    );
    persist(&registry);
    adopted
}

async fn pick_folders<R: Runtime>(
    window: &WebviewWindow<R>,
    multiple: bool,
    default_path: Option<String>,
) -> Vec<PathBuf> {
    #[cfg(feature = "e2e")]
    if let Some(answer) = crate::e2e::scripted::take_from(
        window,
        "open",
        &json!({ "directory": true, "multiple": multiple, "defaultPath": default_path }),
    ) {
        return answer_paths(&answer);
    }
    use tauri_plugin_dialog::DialogExt;
    let mut builder = window.dialog().file().set_parent(window);
    if let Some(directory) = default_path.filter(|value| !value.is_empty()) {
        builder = builder.set_directory(directory);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if multiple {
        builder.pick_folders(move |picked| {
            let _ = sender.send(picked.unwrap_or_default());
        });
    } else {
        builder.pick_folder(move |picked| {
            let _ = sender.send(picked.into_iter().collect());
        });
    }
    receiver
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|picked| picked.into_path().ok())
        .collect()
}

#[tauri::command]
pub async fn grants_pick_folder<R: Runtime>(
    window: WebviewWindow<R>,
    multiple: bool,
    default_path: Option<String>,
) -> Result<Vec<String>, RpcError> {
    let picked: Vec<PathBuf> = pick_folders(&window, multiple, default_path)
        .await
        .into_iter()
        .filter(|path| path.is_dir())
        .collect();
    allow_all(&picked, FolderMode::ReadWrite);
    Ok(picked
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("vivepdf-grants-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, b"x").unwrap();
        path
    }

    #[test]
    fn a_granted_file_is_readable_and_an_unknown_one_is_not() {
        let dir = scratch("files");
        let picked = file(&dir, "picked.pdf");
        let other = file(&dir, "other.pdf");
        let mut registry = Registry::default();

        assert!(registry.allow(&picked, FolderMode::ReadWrite));
        assert!(!registry.allow(&picked, FolderMode::ReadWrite));

        assert!(registry.may_read(&picked));
        assert!(!registry.may_read(&other));
    }

    #[test]
    fn a_granted_folder_opens_everything_below_it_but_not_beside_it() {
        let dir = scratch("folders");
        let folder = dir.join("picked");
        let deep = file(&folder, "sub/deeper/a.pdf");
        let beside = file(&dir, "picked-notes/b.pdf");
        let mut registry = Registry::default();

        registry.allow(&folder, FolderMode::ReadWrite);

        assert!(registry.may_read(&folder.join("new.pdf")));
        assert!(registry.may_read(&deep));
        assert!(!registry.may_read(&beside));
    }

    #[test]
    fn dot_dot_and_letter_case_cannot_step_outside_a_grant() {
        let dir = scratch("escape");
        let folder = dir.join("picked");
        std::fs::create_dir_all(&folder).unwrap();
        let secret = file(&dir, "secret.txt");
        let mut registry = Registry::default();
        registry.allow(&folder, FolderMode::ReadWrite);

        assert!(!registry.may_read(&folder.join("..").join("secret.txt")));
        assert!(!registry.may_read(&secret));
        if cfg!(any(windows, target_os = "macos")) {
            let upper = PathBuf::from(folder.to_string_lossy().to_uppercase()).join("a.pdf");
            assert!(registry.may_read(&upper));
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_inside_a_granted_folder_that_points_outside_is_refused() {
        let dir = scratch("link");
        let folder = dir.join("picked");
        std::fs::create_dir_all(&folder).unwrap();
        let secret = file(&dir, "outside/secret.txt");
        std::os::unix::fs::symlink(&secret, folder.join("link.txt")).unwrap();
        let mut registry = Registry::default();
        registry.allow(&folder, FolderMode::ReadWrite);

        assert!(!registry.may_read(&folder.join("link.txt")));
    }

    #[test]
    fn a_save_target_that_does_not_exist_yet_can_be_granted_and_written() {
        let dir = scratch("save");
        let target = dir.join("new").join("saved.pdf");
        let mut registry = Registry::default();
        registry.allow(&target, FolderMode::ReadWrite);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"x").unwrap();

        assert!(registry.may_write(&target));
        assert!(registry.may_read(&target));
    }

    #[test]
    fn writes_may_land_next_to_a_granted_file_but_reads_may_not() {
        let dir = scratch("sibling");
        let picked = file(&dir, "input.pdf");
        let sibling = dir.join("input-compressed.pdf");
        let elsewhere = scratch("elsewhere").join("x.pdf");
        let mut registry = Registry::default();
        registry.allow(&picked, FolderMode::ReadWrite);

        assert!(registry.may_write(&sibling));
        assert!(!registry.may_read(&sibling));
        assert!(!registry.may_write(&elsewhere));
    }

    #[test]
    fn roots_are_readable_and_only_write_roots_are_writable() {
        let read_root = scratch("read-root");
        let write_root = scratch("write-root");
        let mut registry = Registry {
            read_roots: root_keys(&[read_root.clone(), write_root.clone()]),
            write_roots: root_keys(std::slice::from_ref(&write_root)),
            ..Registry::default()
        };

        assert!(registry.may_read(&read_root.join("grants.json")));
        assert!(!registry.may_write(&read_root.join("grants.json")));
        assert!(registry.may_write(&write_root.join("print.pdf")));
    }

    #[test]
    fn the_oldest_grants_are_forgotten_first_and_use_keeps_a_grant_fresh() {
        let mut recent = Recent::from_keys(vec!["a".into(), "b".into(), "c".into()], 3);
        assert!(!recent.touch("a".into(), 3));
        assert!(recent.touch("d".into(), 3));

        assert_eq!(recent.keys(), vec!["c", "a", "d"]);
        assert!(!recent.contains("b"));
    }

    #[test]
    fn grants_survive_a_round_trip_and_unknown_versions_are_ignored() {
        let dir = scratch("store");
        let picked = file(&dir, "a.pdf");
        let mut registry = Registry::default();
        registry.allow(&picked, FolderMode::ReadWrite);
        let outputs = dir.join("outputs");
        std::fs::create_dir_all(&outputs).unwrap();
        registry.allow(&outputs, FolderMode::Write);
        registry.adopted_round = 1;
        let text = serde_json::to_string(&registry.snapshot()).unwrap();

        let mut loaded = Registry::default();
        loaded.load(&text);
        let mut future = Registry::default();
        future.load(&text.replace("\"version\":3", "\"version\":4"));
        let mut broken = Registry::default();
        broken.load("{");

        assert!(loaded.adopted_round == 1 && loaded.may_read(&picked));
        assert!(
            loaded.may_write(&outputs.join("a.pdf")) && !loaded.may_read(&outputs.join("a.pdf"))
        );
        assert!(future.adopted_round == 0 && !future.may_read(&picked));
        assert_eq!(broken.adopted_round, 0);
    }

    #[test]
    fn a_first_version_store_keeps_its_files_and_its_folders_only_take_writes() {
        let dir = scratch("legacy");
        let picked = file(&dir, "a.pdf");
        let folder = dir.join("folder");
        let inside_folder = file(&folder, "b.pdf");
        let text = json!({
            "version": 1,
            "adopted": true,
            "files": [key_of(&picked)],
            "folders": [key_of(&folder)],
        })
        .to_string();
        let mut registry = Registry::default();

        registry.load(&text);

        assert_eq!(registry.adopted_round, 1);
        assert!(registry.may_read(&picked));
        assert!(!registry.may_read(&inside_folder));
        assert!(registry.may_write(&inside_folder));
    }

    #[test]
    fn an_output_folder_takes_writes_but_its_files_cannot_be_read() {
        let dir = scratch("output-folder");
        let folder = dir.join("out");
        let existing = file(&folder, "private.pdf");
        let mut registry = Registry::default();

        registry.allow(&folder, FolderMode::Write);

        assert!(registry.may_write(&folder.join("result.pdf")));
        assert!(!registry.may_read(&existing));
        assert!(!registry.may_read(&folder));
    }

    #[test]
    fn picking_a_folder_to_read_upgrades_it_and_an_output_pick_never_downgrades_it() {
        let dir = scratch("upgrade");
        let upgraded = dir.join("upgraded");
        let kept = dir.join("kept");
        let one = file(&upgraded, "a.pdf");
        let two = file(&kept, "b.pdf");
        let mut registry = Registry::default();

        registry.allow(&upgraded, FolderMode::Write);
        assert!(registry.allow(&upgraded, FolderMode::ReadWrite));
        registry.allow(&kept, FolderMode::ReadWrite);
        registry.allow(&kept, FolderMode::Write);

        assert!(registry.may_read(&one));
        assert!(registry.may_read(&two));
        assert!(registry.write_folders.keys().is_empty());
    }

    #[test]
    fn a_read_folder_opens_documents_and_subfolders_but_not_hidden_or_other_files() {
        let dir = scratch("filter");
        let folder = dir.join("projects");
        let document = file(&folder, "sub/report.pdf");
        let picture = file(&folder, "scan.PNG");
        let hidden = file(&folder, ".git/config");
        let hidden_document = file(&folder, ".cache/old.pdf");
        let key = file(&folder, "id_rsa");
        let program = file(&folder, "tool.exe");
        let mut registry = Registry::default();
        registry.allow(&folder, FolderMode::ReadWrite);

        assert!(registry.may_read(&folder.join("sub")));
        assert!(registry.may_read(&document));
        assert!(registry.may_read(&picture));
        for refused in [&hidden, &hidden_document, &key, &program] {
            assert!(!registry.may_read(refused), "{}", refused.display());
        }
        assert!(!registry.may_write(&folder.join(".git").join("hooks").join("pre-commit")));
        assert!(registry.may_write(&folder.join("sub").join("merged.pdf")));
    }

    #[test]
    fn the_suggested_output_folder_takes_new_files_but_never_replaces_one() {
        let documents = scratch("documents");
        let existing = file(&documents, "report.pdf");
        let mut registry = Registry {
            create_roots: root_keys(std::slice::from_ref(&documents)),
            ..Registry::default()
        };

        assert!(registry.may_write(&documents.join("poster.pdf")));
        assert!(registry.may_write(&documents.join("poster_pages")));
        assert!(!registry.may_write(&existing));
        assert!(!registry.may_write(&documents));
        assert!(!registry.may_write(&documents.join(".config").join("x.pdf")));
        assert!(!registry.may_read(&documents.join("poster.pdf")));
    }

    #[test]
    fn a_new_output_folder_in_the_suggested_folder_stays_writable_once_it_exists() {
        let documents = scratch("documents-folder");
        let pictures = documents.join("poster");
        let mut registry = Registry {
            create_roots: root_keys(std::slice::from_ref(&documents)),
            ..Registry::default()
        };

        let taken = documents.join("taken");
        std::fs::create_dir_all(&taken).unwrap();

        assert!(registry.grant_new_folder(&pictures));
        std::fs::create_dir_all(&pictures).unwrap();

        assert!(!registry.grant_new_folder(&pictures));
        assert!(registry.may_write(&pictures));
        assert!(!registry.grant_new_folder(&taken));
        assert!(!registry.may_write(&taken));
    }

    #[test]
    fn hidden_names_are_not_written_next_to_a_granted_file() {
        let dir = scratch("hidden-sibling");
        let picked = file(&dir, "input.pdf");
        let mut registry = Registry::default();
        registry.allow(&picked, FolderMode::ReadWrite);

        assert!(!registry.may_write(&dir.join(".hidden.pdf")));
        assert!(registry.may_write(&dir.join("visible.pdf")));
    }

    #[test]
    fn adoption_takes_known_files_and_folders_in_their_mode_but_never_a_root_or_home() {
        let dir = scratch("adopt");
        let home = dir.join("home");
        let picked = file(&home, "docs/a.pdf");
        let watched = home.join("inbox");
        let outputs = home.join("outputs");
        std::fs::create_dir_all(&watched).unwrap();
        std::fs::create_dir_all(&outputs).unwrap();
        let root = std::path::absolute(&dir)
            .unwrap()
            .ancestors()
            .last()
            .unwrap()
            .to_path_buf();
        let text = |path: &Path| path.to_string_lossy().into_owned();
        let mut registry = Registry::default();

        let adopted = registry.adopt(
            &[text(&picked), text(&dir.join("gone.pdf"))],
            &[text(&watched), text(&home), text(&dir), text(&root)],
            &[text(&outputs)],
            Some(&home),
            &AdoptLimits::default(),
        );

        assert_eq!(adopted, 3);
        assert_eq!(registry.adopted_round, ADOPT_ROUND);
        assert!(registry.may_read(&picked));
        assert!(registry.may_read(&watched.join("scan.pdf")));
        assert!(registry.may_write(&outputs.join("out.pdf")));
        assert!(!registry.may_read(&outputs.join("out.pdf")));
        assert!(!registry.may_read(&home.join("notes.pdf")));
    }

    fn text(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[cfg(windows)]
    #[test]
    fn adoption_refuses_network_device_relative_and_stream_paths_by_their_spelling() {
        for refused in [
            r"\\attacker\share\a.pdf",
            r"\\?\UNC\attacker\share\a.pdf",
            r"\\.\pipe\a.pdf",
            "//attacker/share/a.pdf",
            r"C:\docs\..\a.pdf",
            r"C:\docs\a.pdf:hidden",
            r"docs\a.pdf",
            "C:\\docs\\a\0.pdf",
            "",
        ] {
            assert!(!lexically_adoptable(refused), "{refused:?}");
        }
        assert!(lexically_adoptable(r"C:\docs\a.pdf"));
        assert!(lexically_adoptable(r"D:\Belgeler\çizim.pdf"));
    }

    #[test]
    fn adoption_takes_documents_only_and_never_hidden_folders_or_key_files() {
        let dir = scratch("adopt-filter");
        let kept = [
            file(&dir, "docs/REPORT.PDF"),
            file(&dir, "docs/notes.vivedoc"),
            file(&dir, "docs/sources.bib"),
        ];
        let refused = [
            file(&dir, ".ssh/id_rsa.pdf"),
            file(&dir, "docs/.hidden/a.pdf"),
            file(&dir, "docs/id_rsa"),
            file(&dir, "docs/server.pem"),
            file(&dir, "docs/signing.pfx"),
            file(&dir, "docs/signing.p12"),
            file(&dir, "docs/private.key"),
            file(&dir, "docs/tool.exe"),
        ];
        let escaped = format!("{}/docs/../.ssh/id_rsa.pdf", text(&dir));
        let mut paths: Vec<String> = kept
            .iter()
            .chain(refused.iter())
            .map(|path| text(path))
            .collect();
        paths.push(escaped);
        let mut registry = Registry::default();

        let adopted = registry.adopt(&paths, &[], &[], None, &AdoptLimits::default());

        assert_eq!(adopted, kept.len());
        for path in &kept {
            assert!(registry.may_read(path), "{}", path.display());
        }
        for path in &refused {
            assert!(!registry.may_read(path), "{}", path.display());
        }
    }

    #[test]
    fn adoption_refuses_hidden_and_system_folders_but_keeps_cloud_folders_inside_them() {
        let dir = scratch("adopt-places");
        let home = dir.join("home");
        let config = home.join(".config").join("gcloud");
        let library = home.join("Library");
        let preferences = library.join("Preferences");
        let cloud = library.join("CloudStorage").join("Drive");
        let documents = home.join("Documents");
        for folder in [&config, &preferences, &cloud, &documents] {
            std::fs::create_dir_all(folder).unwrap();
        }
        let in_library = file(&preferences, "settings.pdf");
        let in_cloud = file(&cloud, "shared.pdf");
        let limits = AdoptLimits::from_dirs(
            std::slice::from_ref(&library),
            &[library.join("CloudStorage")],
        );
        let mut registry = Registry::default();

        registry.adopt(
            &[text(&in_library), text(&in_cloud)],
            &[text(&config), text(&preferences), text(&cloud)],
            &[text(&config), text(&preferences), text(&documents)],
            Some(&home),
            &limits,
        );

        assert!(!registry.may_read(&in_library));
        assert!(registry.may_read(&in_cloud));
        assert!(!registry.may_read(&config.join("a.pdf")));
        assert!(!registry.may_write(&config.join("a.pdf")));
        assert!(!registry.may_write(&preferences.join("a.pdf")));
        assert!(registry.may_read(&cloud.join("a.pdf")));
        assert!(registry.may_write(&documents.join("a.pdf")));
    }

    #[test]
    fn an_adopted_file_is_read_only_until_the_user_picks_it_again() {
        let dir = scratch("adopt-read-only");
        let adopted = file(&dir, "report.pdf");
        let existing = file(&dir, "other.pdf");
        let fresh = dir.join("report-compressed.pdf");
        let mut registry = Registry::default();

        registry.adopt(&[text(&adopted)], &[], &[], None, &AdoptLimits::default());

        assert!(registry.may_read(&adopted));
        assert!(!registry.may_write(&adopted));
        assert!(registry.may_write(&fresh));
        assert!(!registry.may_write(&existing));
        assert!(!registry.may_read(&existing));

        registry.allow(&adopted, FolderMode::Write);

        assert!(registry.may_write(&adopted));
        assert!(registry.read_files.keys().is_empty());
    }

    #[test]
    fn a_second_version_store_loads_and_keeps_read_only_files_apart() {
        let dir = scratch("v2");
        let picked = file(&dir, "picked.pdf");
        let adopted = file(&dir, "adopted/adopted.pdf");
        let text = json!({
            "version": 2,
            "adoptedRound": 2,
            "files": [key_of(&picked)],
            "folders": [],
        })
        .to_string();
        let mut registry = Registry::default();

        registry.load(&text);
        registry.adopt(
            &[self::text(&adopted)],
            &[],
            &[],
            None,
            &AdoptLimits::default(),
        );
        let mut reloaded = Registry::default();
        reloaded.load(&serde_json::to_string(&registry.snapshot()).unwrap());

        assert_eq!(registry.adopted_round, ADOPT_ROUND);
        assert!(reloaded.may_write(&picked));
        assert!(reloaded.may_read(&adopted) && !reloaded.may_write(&adopted));
    }

    #[cfg(windows)]
    #[test]
    fn op_paths_on_a_network_share_are_refused_unless_a_grant_already_reaches_it() {
        let registry = Registry {
            files: Recent::from_keys(vec!["//?/unc/nas/share/docs/a.pdf".into()], FILE_KEEP),
            folders: Recent::from_keys(vec!["//office/scans".into()], FOLDER_KEEP),
            ..Registry::default()
        };

        for allowed in [
            r"\\nas\share\docs\a.pdf",
            r"\\NAS\share\docs\b.pdf",
            r"\\?\UNC\nas\share\docs\a.pdf",
            r"\\office\scans\2026\x.pdf",
            r"C:\docs\a.pdf",
        ] {
            assert!(
                !registry.reaches_network_unasked(Path::new(allowed)),
                "{allowed}"
            );
        }
        for refused in [
            r"\\attacker\share\a.pdf",
            r"\\nas\share\other\a.pdf",
            r"\\nas\share\docs\..\..\..\x\a.pdf",
            r"\\.\pipe\a.pdf",
            r"\\nas",
        ] {
            assert!(
                registry.reaches_network_unasked(Path::new(refused)),
                "{refused}"
            );
        }
        assert!(check_read(Path::new(r"\\vivepdf-no-such-host\share\a.pdf")).is_err());
    }

    #[test]
    fn a_first_round_store_is_offered_the_second_round() {
        let mut registry = Registry::default();
        registry.load(r#"{"version":1,"adopted":true,"files":[],"folders":[]}"#);

        assert!(registry.adopted_round < ADOPT_ROUND);
    }

    #[test]
    fn a_dialog_answer_grants_every_picked_path() {
        let dir = scratch("answer");
        let one = file(&dir, "one.pdf");
        let two = file(&dir, "two.pdf");

        allow_answer(&json!([one.to_string_lossy(), two.to_string_lossy()]));
        allow_answer(&serde_json::Value::Null);

        assert!(check_read(&one).is_ok());
        assert!(check_read(&two).is_ok());
        let error = check_read(&dir.join("three.pdf")).unwrap_err();
        assert_eq!(error.code, "PERMISSION_DENIED");
        assert_eq!(error.data, Some(json!({ "reason": "notGranted" })));
    }
}

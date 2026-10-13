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
const GRANTS_VERSION: u32 = 1;
const FILE_KEEP: usize = 2000;
const FOLDER_KEEP: usize = 200;
const ADOPT_LIMIT: usize = 1000;

#[derive(Serialize, Deserialize)]
struct Stored {
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

    fn keys(&self) -> Vec<String> {
        self.order.iter().cloned().collect()
    }
}

#[derive(Default)]
struct Registry {
    files: Recent,
    folders: Recent,
    adopted: bool,
    read_roots: Vec<String>,
    write_roots: Vec<String>,
    store: Option<PathBuf>,
}

fn key_of(path: &Path) -> String {
    comparable(&resolved(path))
        .trim_end_matches('/')
        .to_string()
}

fn inside(key: &str, base: &str) -> bool {
    key == base
        || key
            .strip_prefix(base)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn parent_key(key: &str) -> Option<&str> {
    key.rsplit_once('/').map(|(parent, _)| parent)
}

impl Registry {
    fn load(&mut self, text: &str) {
        let Ok(stored) = serde_json::from_str::<Stored>(text) else {
            return;
        };
        if stored.version != GRANTS_VERSION {
            return;
        }
        self.files = Recent::from_keys(stored.files, FILE_KEEP);
        self.folders = Recent::from_keys(stored.folders, FOLDER_KEEP);
        self.adopted = stored.adopted;
    }

    fn snapshot(&self) -> Stored {
        Stored {
            version: GRANTS_VERSION,
            adopted: self.adopted,
            files: self.files.keys(),
            folders: self.folders.keys(),
        }
    }

    fn allow(&mut self, path: &Path) -> bool {
        let key = key_of(path);
        if key.is_empty() {
            return false;
        }
        if path.is_dir() {
            self.folders.touch(key, FOLDER_KEEP)
        } else {
            self.files.touch(key, FILE_KEEP)
        }
    }

    fn in_granted_folder(&self, key: &str) -> bool {
        self.folders.order.iter().any(|folder| inside(key, folder))
    }

    fn may_read(&mut self, path: &Path) -> bool {
        let key = key_of(path);
        if self.files.contains(&key) {
            self.files.touch(key, FILE_KEEP);
            return true;
        }
        self.in_granted_folder(&key) || self.read_roots.iter().any(|root| inside(&key, root))
    }

    fn may_write(&mut self, path: &Path) -> bool {
        let key = key_of(path);
        if self.files.contains(&key)
            || self.in_granted_folder(&key)
            || self.write_roots.iter().any(|root| inside(&key, root))
        {
            return true;
        }
        let Some(parent) = parent_key(&key) else {
            return false;
        };
        self.files
            .order
            .iter()
            .any(|file| parent_key(file) == Some(parent))
    }
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
        registry.store = store;
    }
    use tauri_plugin_fs::FsExt;
    if let Some(scope) = app.try_fs_scope() {
        scope.listen(|event| {
            let tauri::scope::fs::Event::PathAllowed(path) = event else {
                return;
            };
            allow_path(path);
        });
    }
}

pub fn allow_path(path: &Path) {
    let mut registry = registry();
    if registry.allow(path) {
        persist(&registry);
    }
}

pub fn allow_paths<S: AsRef<str>>(paths: &[S]) {
    let mut registry = registry();
    let mut changed = false;
    for path in paths {
        changed |= registry.allow(Path::new(path.as_ref()));
    }
    if changed {
        persist(&registry);
    }
}

#[cfg(any(test, feature = "e2e"))]
pub fn allow_answer(answer: &serde_json::Value) {
    match answer {
        serde_json::Value::String(path) => allow_path(Path::new(path)),
        serde_json::Value::Array(items) => {
            let paths: Vec<&str> = items.iter().filter_map(serde_json::Value::as_str).collect();
            allow_paths(&paths);
        }
        _ => {}
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
    if registry().may_read(path) || crate::files::was_produced(path) {
        return Ok(());
    }
    Err(not_granted(path))
}

pub fn check_write(path: &Path) -> Result<(), RpcError> {
    if registry().may_write(path) || crate::files::was_produced(path) {
        return Ok(());
    }
    Err(not_granted(path))
}

#[tauri::command]
pub fn grants_adopt<R: Runtime>(window: WebviewWindow<R>, paths: Vec<String>) -> usize {
    if window.label() != MAIN_WINDOW {
        return 0;
    }
    let mut registry = registry();
    if registry.adopted {
        return 0;
    }
    let mut adopted = 0;
    for path in paths.iter().take(ADOPT_LIMIT).map(Path::new) {
        if path.is_file() && registry.allow(path) {
            adopted += 1;
        }
    }
    registry.adopted = true;
    persist(&registry);
    adopted
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

        assert!(registry.allow(&picked));
        assert!(!registry.allow(&picked));

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

        registry.allow(&folder);

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
        registry.allow(&folder);

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
        registry.allow(&folder);

        assert!(!registry.may_read(&folder.join("link.txt")));
    }

    #[test]
    fn a_save_target_that_does_not_exist_yet_can_be_granted_and_written() {
        let dir = scratch("save");
        let target = dir.join("new").join("saved.pdf");
        let mut registry = Registry::default();
        registry.allow(&target);
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
        registry.allow(&picked);

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
        registry.allow(&picked);
        registry.allow(&dir);
        registry.adopted = true;
        let text = serde_json::to_string(&registry.snapshot()).unwrap();

        let mut loaded = Registry::default();
        loaded.load(&text);
        let mut future = Registry::default();
        future.load(&text.replace("\"version\":1", "\"version\":2"));
        let mut broken = Registry::default();
        broken.load("{");

        assert!(loaded.adopted && loaded.may_read(&picked));
        assert!(!future.adopted && !future.may_read(&picked));
        assert!(!broken.adopted);
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

use std::collections::{HashSet, VecDeque};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

use crate::rpc::RpcError;

const BACKUP_DIR_NAME: &str = "backups";
const BACKUP_KEEP: usize = 20;

const PRODUCED_FILE_NAME: &str = "produced.json";
const PRODUCED_KEEP: usize = 500;

static PRODUCED_STORE: OnceLock<PathBuf> = OnceLock::new();

pub fn set_produced_store<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = PRODUCED_STORE.set(dir.join(PRODUCED_FILE_NAME));
    }
}

fn stored_keys() -> Vec<String> {
    let Some(path) = PRODUCED_STORE.get() else {
        return Vec::new();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

fn write_keys(keys: &[String]) {
    let Some(path) = PRODUCED_STORE.get() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(keys) {
        let _ = std::fs::write(path, text);
    }
}

#[derive(Default)]
struct ProducedFiles {
    order: VecDeque<String>,
    known: HashSet<String>,
}

impl ProducedFiles {
    fn from_keys(keys: Vec<String>, keep: usize) -> Self {
        let mut produced = Self::default();
        for key in keys {
            produced.insert(key, keep);
        }
        produced
    }

    fn insert(&mut self, key: String, keep: usize) -> bool {
        if self.known.contains(&key) {
            return false;
        }
        self.known.insert(key.clone());
        self.order.push_back(key);
        while self.order.len() > keep {
            if let Some(oldest) = self.order.pop_front() {
                self.known.remove(&oldest);
            }
        }
        true
    }

    fn contains(&self, key: &str) -> bool {
        self.known.contains(key)
    }

    fn keys(&self) -> Vec<String> {
        self.order.iter().cloned().collect()
    }
}

fn produced_files() -> &'static Mutex<ProducedFiles> {
    static PRODUCED: OnceLock<Mutex<ProducedFiles>> = OnceLock::new();
    PRODUCED.get_or_init(|| Mutex::new(ProducedFiles::from_keys(stored_keys(), PRODUCED_KEEP)))
}

fn path_key(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase()
}

pub fn remember_produced(path: &str) {
    let Ok(mut produced) = produced_files().lock() else {
        return;
    };
    if !produced.insert(path_key(Path::new(path)), PRODUCED_KEEP) {
        return;
    }
    write_keys(&produced.keys());
}

fn was_produced(path: &Path) -> bool {
    produced_files()
        .lock()
        .map(|produced| produced.contains(&path_key(path)))
        .unwrap_or(false)
}

pub(crate) fn io_error(error: std::io::Error) -> RpcError {
    match error.kind() {
        std::io::ErrorKind::NotFound => RpcError::new("FILE_NOT_FOUND", error.to_string()),
        std::io::ErrorKind::PermissionDenied => {
            RpcError::new("PERMISSION_DENIED", error.to_string())
        }
        _ => RpcError::new("INTERNAL", error.to_string()),
    }
}

#[tauri::command]
pub async fn read_document(path: String) -> Result<Response, RpcError> {
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
        .map_err(io_error)?;
    Ok(Response::new(bytes))
}

fn backup_name(target: &Path) -> String {
    let stem = target
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    let extension = target
        .extension()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "pdf".to_string());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    format!("{stem}.{stamp}.{extension}")
}

fn prune_backups(directory: &Path) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect();
    if files.len() <= BACKUP_KEEP {
        return;
    }
    files.sort_by_key(|left| std::cmp::Reverse(left.0));
    for (_, path) in files.into_iter().skip(BACKUP_KEEP) {
        let _ = std::fs::remove_file(path);
    }
}

fn store_backup(directory: &Path, target: &Path) -> Result<(), RpcError> {
    std::fs::create_dir_all(directory).map_err(io_error)?;
    std::fs::copy(target, directory.join(backup_name(target))).map_err(io_error)?;
    prune_backups(directory);
    Ok(())
}

fn temporary_path(target: &Path) -> PathBuf {
    let stem = target
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    target.with_file_name(format!(".{stem}.{}.tmp-vivepdf", uuid::Uuid::new_v4()))
}

#[tauri::command]
pub async fn write_document(app: tauri::AppHandle, request: Request<'_>) -> Result<u64, RpcError> {
    let keep_backup = request
        .headers()
        .get("x-backup")
        .and_then(|value| value.to_str().ok())
        .map(|value| value != "off")
        .unwrap_or(true);
    let backup_dir = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join(BACKUP_DIR_NAME))
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    let path = request
        .headers()
        .get("x-path")
        .and_then(|value| value.to_str().ok())
        .map(|value| urlencoding::decode(value).map(|decoded| decoded.into_owned()))
        .transpose()
        .map_err(|error| RpcError::new("INVALID_PARAMS", error.to_string()))?
        .ok_or_else(|| RpcError::new("INVALID_PARAMS", "missing x-path header"))?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => {
            return Err(RpcError::new("INVALID_PARAMS", "expected a binary body"))
        }
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<u64, RpcError> {
        let target = PathBuf::from(&path);
        if keep_backup && target.exists() {
            store_backup(&backup_dir, &target)?;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(io_error)?;
        }
        let temporary = temporary_path(&target);
        let write_result = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(io_error)
            .and_then(|mut file| file.write_all(&bytes).map_err(io_error));
        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        if let Err(error) = std::fs::rename(&temporary, &target) {
            let _ = std::fs::remove_file(&temporary);
            return Err(io_error(error));
        }
        crate::doc_watch::refresh_stamp(&target);
        Ok(bytes.len() as u64)
    })
    .await
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), RpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = PathBuf::from(&path);
        if !target.is_file() {
            return Err(RpcError::new(
                "FILE_NOT_FOUND",
                format!("not a file: {path}"),
            ));
        }
        if !was_produced(&target) {
            return Err(RpcError::new(
                "PERMISSION_DENIED",
                format!("not written by this session: {path}"),
            ));
        }
        std::fs::remove_file(&target).map_err(io_error)
    })
    .await
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

const OPENABLE_PICTURE_EXTENSIONS: [&str; 11] = [
    "png", "jpg", "jpeg", "jpx", "jp2", "bmp", "gif", "tif", "tiff", "webp", "jxr",
];

const OPENABLE_DOCUMENT_EXTENSIONS: [&str; 22] = [
    "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf", "txt", "md",
    "csv", "tsv", "json", "xml", "html", "htm", "epub", "svg", "zip",
];

fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .map(|value| value.to_string_lossy().to_lowercase())
}

fn is_openable_picture(path: &Path) -> bool {
    extension_of(path).is_some_and(|ext| OPENABLE_PICTURE_EXTENSIONS.contains(&ext.as_str()))
}

fn is_openable_output(path: &Path) -> bool {
    is_openable_picture(path)
        || extension_of(path)
            .is_some_and(|ext| OPENABLE_DOCUMENT_EXTENSIONS.contains(&ext.as_str()))
}

#[tauri::command]
pub async fn open_produced_picture(app: tauri::AppHandle, path: String) -> Result<(), RpcError> {
    use tauri_plugin_opener::OpenerExt;
    let target = PathBuf::from(&path);
    if !target.is_file() {
        return Err(RpcError::new(
            "FILE_NOT_FOUND",
            format!("not a file: {path}"),
        ));
    }
    if !is_openable_picture(&target) || !was_produced(&target) {
        return Err(RpcError::new(
            "PERMISSION_DENIED",
            format!("not a picture written by this session: {path}"),
        ));
    }
    app.opener()
        .open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

#[tauri::command]
pub async fn open_produced_file(app: tauri::AppHandle, path: String) -> Result<(), RpcError> {
    use tauri_plugin_opener::OpenerExt;
    let target = PathBuf::from(&path);
    if !target.is_file() {
        return Err(RpcError::new(
            "FILE_NOT_FOUND",
            format!("not a file: {path}"),
        ));
    }
    if !is_openable_output(&target) || !was_produced(&target) {
        return Err(RpcError::new(
            "PERMISSION_DENIED",
            format!("not a document written by this session: {path}"),
        ));
    }
    app.opener()
        .open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

#[tauri::command]
pub async fn open_folder(app: tauri::AppHandle, path: String) -> Result<(), RpcError> {
    use tauri_plugin_opener::OpenerExt;
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Err(RpcError::new(
            "FILE_NOT_FOUND",
            format!("not a folder: {path}"),
        ));
    }
    app.opener()
        .open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_picture_extensions_are_openable() {
        assert!(is_openable_picture(Path::new("C:/tmp/resim.PNG")));
        assert!(is_openable_picture(Path::new("/tmp/photo.jpeg")));
        assert!(!is_openable_picture(Path::new("/tmp/setup.exe")));
        assert!(!is_openable_picture(Path::new("/tmp/script.bat")));
        assert!(!is_openable_picture(Path::new("/tmp/no-extension")));
    }

    #[test]
    fn outputs_open_only_as_documents_or_pictures() {
        assert!(is_openable_output(Path::new("C:/out/rapor.PDF")));
        assert!(is_openable_output(Path::new("C:/out/rapor.docx")));
        assert!(is_openable_output(Path::new("C:/out/sayfa-1.png")));
        assert!(!is_openable_output(Path::new("C:/out/ek.exe")));
        assert!(!is_openable_output(Path::new("C:/out/ek.lnk")));
        assert!(!is_openable_output(Path::new("C:/out/ek.hta")));
        assert!(!is_openable_output(Path::new("C:/out/ek.cmd")));
        assert!(!is_openable_output(Path::new("C:/out/no-extension")));
    }

    #[test]
    fn backup_name_keeps_stem_and_extension() {
        let name = backup_name(Path::new("C:/docs/report.pdf"));
        assert!(name.starts_with("report."));
        assert!(name.ends_with(".pdf"));
    }

    #[test]
    fn backup_name_is_unique_over_time() {
        let target = Path::new("C:/docs/report.pdf");
        let first = backup_name(target);
        std::thread::sleep(std::time::Duration::from_millis(2));
        assert_ne!(first, backup_name(target));
    }

    #[test]
    fn prune_backups_keeps_the_newest_only() {
        let directory =
            std::env::temp_dir().join(format!("vivepdf-backups-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        for index in 0..(BACKUP_KEEP + 5) {
            std::fs::write(directory.join(format!("file-{index}.pdf")), b"x").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        prune_backups(&directory);
        let left = std::fs::read_dir(&directory).unwrap().count();
        std::fs::remove_dir_all(&directory).unwrap();
        assert_eq!(left, BACKUP_KEEP);
    }

    #[test]
    fn the_produced_list_forgets_the_oldest_files_first() {
        let mut produced = ProducedFiles::from_keys(vec!["a".into(), "b".into(), "c".into()], 3);
        assert!(produced.insert("d".into(), 3));
        assert!(!produced.insert("d".into(), 3));
        assert!(!produced.contains("a"));
        assert!(produced.contains("d"));
        assert_eq!(produced.keys(), vec!["b", "c", "d"]);
    }

    #[test]
    fn a_stored_list_longer_than_the_limit_keeps_its_newest_entries() {
        let keys: Vec<String> = (0..10).map(|index| index.to_string()).collect();
        let produced = ProducedFiles::from_keys(keys, 4);
        assert_eq!(produced.keys(), vec!["6", "7", "8", "9"]);
    }

    #[test]
    fn only_files_this_session_produced_are_deletable() {
        let path = std::env::temp_dir().join(format!("vivepdf-{}.pdf", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"x").unwrap();
        assert!(!was_produced(&path));
        remember_produced(&path.to_string_lossy());
        assert!(was_produced(&path));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn temporary_path_is_unique_per_call() {
        let target = Path::new("C:/docs/report.pdf");
        assert_ne!(temporary_path(target), temporary_path(target));
    }

    #[test]
    fn temporary_path_uses_marker_suffix() {
        let path = temporary_path(Path::new("C:/docs/report.pdf"));
        assert!(path.to_string_lossy().ends_with(".tmp-vivepdf"));
    }
}

use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::rpc::RpcError;

const LOG_FILE_NAME: &str = "vivepdf.log";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const LOG_TAIL_LINES: usize = 200;

fn io_error(error: std::io::Error) -> RpcError {
    match error.kind() {
        std::io::ErrorKind::NotFound => RpcError::new("FILE_NOT_FOUND", error.to_string()),
        std::io::ErrorKind::PermissionDenied => {
            RpcError::new("PERMISSION_DENIED", error.to_string())
        }
        _ => RpcError::new("INTERNAL", error.to_string()),
    }
}

fn rotated_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| LOG_FILE_NAME.to_string());
    path.with_file_name(format!("{file_name}.1"))
}

fn rotate_if_needed(path: &Path, incoming_len: u64) -> std::io::Result<()> {
    let current_len = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if current_len + incoming_len <= MAX_LOG_BYTES {
        return Ok(());
    }
    let rotated = rotated_path(path);
    if rotated.exists() {
        std::fs::remove_file(&rotated)?;
    }
    std::fs::rename(path, &rotated)
}

fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(line.as_bytes())?;
    file.write_all(b"\n")
}

fn case_insensitive_replace(haystack: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return haystack.to_string();
    }
    let haystack_lower = haystack.to_lowercase();
    let needle_lower = needle.to_lowercase();
    let mut result = String::with_capacity(haystack.len());
    let mut last_end = 0;
    let mut search_start = 0;
    while let Some(found) = haystack_lower[search_start..].find(&needle_lower) {
        let start = search_start + found;
        let end = start + needle.len();
        result.push_str(&haystack[last_end..start]);
        result.push_str(replacement);
        last_end = end;
        search_start = end;
    }
    result.push_str(&haystack[last_end..]);
    result
}

fn home_dir() -> Option<String> {
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var(home_var).ok()
}

fn redact_home(text: &str, home: Option<&str>) -> String {
    match home {
        Some(home) if !home.is_empty() => case_insensitive_replace(text, home, "~"),
        _ => text.to_string(),
    }
}

fn redact(text: &str) -> String {
    redact_home(text, home_dir().as_deref())
}

fn resolve_log_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, RpcError> {
    app.path()
        .app_log_dir()
        .map(|dir| dir.join(LOG_FILE_NAME))
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

fn timestamp() -> String {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", elapsed.as_secs())
}

fn write_log_entry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    level: &str,
    source: &str,
    message: &str,
) -> Result<(), RpcError> {
    let path = resolve_log_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io_error)?;
    }
    let line = entry_line(level, source, message, home_dir().as_deref());
    append_entry(&path, &line).map_err(io_error)
}

fn entry_line(level: &str, source: &str, message: &str, home: Option<&str>) -> String {
    format!(
        "[{}] [{}] [{}] {}",
        timestamp(),
        level.to_uppercase(),
        source,
        redact_home(message, home)
    )
}

fn append_entry(path: &Path, line: &str) -> std::io::Result<()> {
    rotate_if_needed(path, line.len() as u64 + 1)?;
    append_line(path, line)
}

fn tail_lines(path: &Path, count: usize) -> std::io::Result<String> {
    let content = std::fs::read_to_string(path)?;
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(count);
    Ok(lines[start..].join("\n"))
}

#[tauri::command]
pub async fn log_line(
    app: tauri::AppHandle,
    level: String,
    source: String,
    message: String,
) -> Result<(), RpcError> {
    tauri::async_runtime::spawn_blocking(move || write_log_entry(&app, &level, &source, &message))
        .await
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

pub fn log_line_sync<R: Runtime>(
    app: &tauri::AppHandle<R>,
    level: &str,
    source: &str,
    message: &str,
) {
    let _ = write_log_entry(app, level, source, message);
}

pub fn log_sidecar<R: Runtime>(app: &tauri::AppHandle<R>, level: &str, message: &str) {
    eprintln!("[sidecar] {message}");
    log_line_sync(app, level, "sidecar", message);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub app_version: String,
    pub locale: Option<String>,
    pub log_path: String,
    pub log_tail: String,
}

#[tauri::command]
pub async fn diagnostics_info(app: tauri::AppHandle) -> Result<DiagnosticsInfo, RpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_log_path(&app)?;
        let os = std::env::consts::OS.to_string();
        let tail = tail_lines(&path, LOG_TAIL_LINES).unwrap_or_default();
        Ok(DiagnosticsInfo {
            os: os.clone(),
            os_version: os,
            arch: std::env::consts::ARCH.to_string(),
            app_version: app.package_info().version.to_string(),
            locale: std::env::var("LANG").ok(),
            log_path: path.to_string_lossy().to_string(),
            log_tail: redact(&tail),
        })
    })
    .await
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

#[tauri::command]
pub async fn open_log_dir(app: tauri::AppHandle) -> Result<(), RpcError> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(io_error)?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

const TEXT_EXTENSIONS: [&str; 6] = ["txt", "md", "log", "json", "csv", "text"];

fn is_text_target(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| TEXT_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), RpcError> {
    if !is_text_target(&path) {
        return Err(RpcError::new(
            "INVALID_PARAMS",
            "only plain text files can be written here",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&path, contents).map_err(io_error))
        .await
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

#[cfg(target_os = "linux")]
fn parent_dir_of(path: &str) -> String {
    std::path::Path::new(path)
        .parent()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[tauri::command]
pub async fn reveal_path(path: String) -> Result<(), RpcError> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), RpcError> {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{path}"))
                .spawn()
                .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .args(["-R", &path])
                .spawn()
                .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(parent_dir_of(&path))
                .spawn()
                .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
        }
        Ok(())
    })
    .await
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

#[tauri::command]
pub async fn path_exists(paths: Vec<String>) -> Result<Vec<bool>, RpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| std::path::Path::new(&path).exists())
            .collect::<Vec<bool>>()
    })
    .await
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

fn path_kind(path: &std::path::Path) -> &'static str {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => "directory",
        Ok(_) => "file",
        Err(_) => "missing",
    }
}

#[tauri::command]
pub async fn path_kinds(paths: Vec<String>) -> Result<Vec<&'static str>, RpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| path_kind(std::path::Path::new(&path)))
            .collect::<Vec<&'static str>>()
    })
    .await
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

pub fn install_panic_hook<R: Runtime>(app: tauri::AppHandle<R>) {
    std::panic::set_hook(Box::new(move |info| {
        log_line_sync(&app, "panic", "rust", &info.to_string());
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_text_targets_are_writable() {
        assert!(is_text_target("C:/reports/vivepdf-report.txt"));
        assert!(is_text_target("/home/user/notes.MD"));
        assert!(!is_text_target("C:/Users/PC/Startup/evil.bat"));
        assert!(!is_text_target("C:/Users/PC/Documents/report.pdf"));
        assert!(!is_text_target("C:/Users/PC/no-extension"));
    }

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("vivepdf-diagnostics-{label}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn append_line_writes_content() {
        let dir = temp_dir("append");
        let path = dir.join(LOG_FILE_NAME);
        append_line(&path, "hello").unwrap();
        append_line(&path, "world").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content, "hello\nworld\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rotate_if_needed_keeps_small_file() {
        let dir = temp_dir("rotate-small");
        let path = dir.join(LOG_FILE_NAME);
        append_line(&path, "short line").unwrap();
        rotate_if_needed(&path, 10).unwrap();
        assert!(path.exists());
        assert!(!rotated_path(&path).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rotate_if_needed_rotates_when_over_limit() {
        let dir = temp_dir("rotate-big");
        let path = dir.join(LOG_FILE_NAME);
        std::fs::write(&path, vec![b'a'; MAX_LOG_BYTES as usize]).unwrap();
        rotate_if_needed(&path, 100).unwrap();
        assert!(!path.exists());
        assert!(rotated_path(&path).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rotate_if_needed_overwrites_previous_rotation() {
        let dir = temp_dir("rotate-overwrite");
        let path = dir.join(LOG_FILE_NAME);
        std::fs::write(rotated_path(&path), "old").unwrap();
        std::fs::write(&path, vec![b'a'; MAX_LOG_BYTES as usize]).unwrap();
        rotate_if_needed(&path, 100).unwrap();
        let rotated_content = std::fs::read_to_string(rotated_path(&path)).unwrap();
        assert_eq!(rotated_content.len(), MAX_LOG_BYTES as usize);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_sidecar_line_reaches_the_rolling_log_without_the_home_folder() {
        let dir = temp_dir("sidecar");
        let path = dir.join(LOG_FILE_NAME);
        let traceback = r#"File "C:\Users\Tester\AppData\vivepdf\ops\pages.py", line 9"#;
        let line = entry_line("error", "sidecar", traceback, Some(r"c:\users\tester"));
        append_entry(&path, &line).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(
            content.contains(r#"[ERROR] [sidecar] File "~\AppData\vivepdf\ops\pages.py", line 9"#)
        );
        assert!(!content.to_lowercase().contains("tester"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sidecar_lines_rotate_with_the_rest_of_the_log() {
        let dir = temp_dir("sidecar-rotate");
        let path = dir.join(LOG_FILE_NAME);
        std::fs::write(&path, vec![b'a'; MAX_LOG_BYTES as usize]).unwrap();
        append_entry(&path, &entry_line("warn", "sidecar", "late line", None)).unwrap();
        assert!(rotated_path(&path).exists());
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .ends_with("[WARN] [sidecar] late line\n"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn redact_replaces_home_directory() {
        let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let original = std::env::var(home_var).ok();
        std::env::set_var(home_var, "C:/Users/tester");
        let text = "log at C:/Users/tester/app.log failed";
        assert_eq!(redact(text), "log at ~/app.log failed");
        match original {
            Some(value) => std::env::set_var(home_var, value),
            None => std::env::remove_var(home_var),
        }
    }

    #[test]
    fn redact_is_case_insensitive_for_drive_letter() {
        let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let original = std::env::var(home_var).ok();
        std::env::set_var(home_var, "C:/Users/tester");
        let text = "log at c:/users/tester/app.log failed";
        assert_eq!(redact(text), "log at ~/app.log failed");
        match original {
            Some(value) => std::env::set_var(home_var, value),
            None => std::env::remove_var(home_var),
        }
    }

    #[test]
    fn path_kind_tells_folders_from_files() {
        let dir = temp_dir("kinds");
        let folder = dir.join("Trip.2024");
        std::fs::create_dir_all(&folder).unwrap();
        let file = dir.join("notes");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(path_kind(&folder), "directory");
        assert_eq!(path_kind(&file), "file");
        assert_eq!(path_kind(&dir.join("gone")), "missing");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

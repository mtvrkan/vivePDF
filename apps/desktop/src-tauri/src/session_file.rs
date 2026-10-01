use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::rpc::RpcError;

const SESSION_FILE_NAME: &str = "session.json";
const MAX_SESSION_BYTES: usize = 4 * 1024 * 1024;

fn session_path(app: &tauri::AppHandle) -> Result<PathBuf, RpcError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(SESSION_FILE_NAME))
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

fn io_error(error: std::io::Error) -> RpcError {
    RpcError::new("INTERNAL", error.to_string())
}

fn read_snapshot(path: &Path) -> std::io::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(text) if text.len() <= MAX_SESSION_BYTES && !text.trim().is_empty() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn write_snapshot(path: &Path, contents: Option<&str>) -> Result<(), RpcError> {
    let Some(contents) = contents else {
        return match std::fs::remove_file(path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io_error(error)),
            _ => Ok(()),
        };
    };
    if contents.len() > MAX_SESSION_BYTES {
        return Err(RpcError::new(
            "INVALID_PARAMS",
            "session snapshot too large",
        ));
    }
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| RpcError::new("INVALID_PARAMS", error.to_string()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io_error)?;
    }
    let staging = path.with_extension("json.tmp");
    std::fs::write(&staging, contents).map_err(io_error)?;
    std::fs::rename(&staging, path).map_err(|error| {
        let _ = std::fs::remove_file(&staging);
        io_error(error)
    })
}

#[tauri::command]
pub async fn session_read(app: tauri::AppHandle) -> Result<Option<String>, RpcError> {
    let path = session_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_snapshot(&path).map_err(io_error))
        .await
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

#[tauri::command]
pub async fn session_write(
    app: tauri::AppHandle,
    contents: Option<String>,
) -> Result<(), RpcError> {
    let path = session_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || write_snapshot(&path, contents.as_deref()))
        .await
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("vivepdf-session-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("nested").join(SESSION_FILE_NAME)
    }

    #[test]
    fn a_written_snapshot_is_read_back() {
        let path = scratch("roundtrip");
        let snapshot = r#"{"savedAt":1,"route":"/viewer","documents":["C:/ş ğ/a.pdf"]}"#;
        write_snapshot(&path, Some(snapshot)).unwrap();
        assert_eq!(read_snapshot(&path).unwrap().as_deref(), Some(snapshot));
        assert!(!path.with_extension("json.tmp").exists());
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn clearing_removes_the_file_and_a_missing_file_reads_as_none() {
        let path = scratch("clear");
        write_snapshot(&path, Some("{}")).unwrap();
        write_snapshot(&path, None).unwrap();
        assert!(!path.exists());
        assert_eq!(read_snapshot(&path).unwrap(), None);
        write_snapshot(&path, None).unwrap();
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn invalid_or_oversized_snapshots_are_refused_and_keep_the_old_file() {
        let path = scratch("refuse");
        write_snapshot(&path, Some(r#"{"savedAt":2}"#)).unwrap();
        let refused = write_snapshot(&path, Some("not json")).unwrap_err();
        assert_eq!(refused.code, "INVALID_PARAMS");
        let huge = format!("\"{}\"", "a".repeat(MAX_SESSION_BYTES));
        assert_eq!(
            write_snapshot(&path, Some(&huge)).unwrap_err().code,
            "INVALID_PARAMS"
        );
        assert_eq!(
            read_snapshot(&path).unwrap().as_deref(),
            Some(r#"{"savedAt":2}"#)
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }
}

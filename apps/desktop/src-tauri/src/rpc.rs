use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::doc_watch;
use crate::files;
use crate::grants;
use crate::path_gate;
use crate::sidecar;
use crate::write_guard;

const SEARCH_FOLDER_METHODS: [&str; 3] = ["search.folders", "search.add_folder", "search.index"];
const CLIPBOARD_METHOD: &str = "create.clipboard";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            data: None,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct IncomingMessage {
    pub id: Option<String>,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<RpcError>,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub detail: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub id: String,
    pub progress: f64,
    pub message: Option<String>,
    pub detail: Option<Value>,
}

#[derive(Serialize)]
pub struct OutgoingRequest<'a> {
    pub id: &'a str,
    pub method: &'a str,
    pub params: &'a Value,
}

#[tauri::command]
pub async fn rpc(
    app: AppHandle,
    id: String,
    method: String,
    params: Value,
) -> Result<Value, RpcError> {
    if method == "cancel" {
        return Err(RpcError::new("INVALID_PARAMS", "use rpc_cancel"));
    }
    write_guard::check_params(&params)?;
    let scope = path_gate::check_op(&method, &params)?;
    let watched = doc_watch::begin_call(&params);
    let lists_search_folders = SEARCH_FOLDER_METHODS.contains(&method.as_str());
    let reads_clipboard = method == CLIPBOARD_METHOD;
    let result = sidecar::call(&app, id, method, params).await;
    if let Ok(value) = &result {
        remember_outputs(value, &scope);
        if lists_search_folders {
            grants::adopt_engine_folders(&search_folders(value));
        }
        if reads_clipboard {
            grants::allow_paths(&clipboard_files(value));
        }
    }
    doc_watch::end_call(watched);
    result
}

fn search_folders(value: &Value) -> Vec<&str> {
    value
        .get("folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|folder| folder.get("path").and_then(Value::as_str))
        .collect()
}

fn clipboard_files(value: &Value) -> Vec<&str> {
    if value.get("kind").and_then(Value::as_str) != Some("files") {
        return Vec::new();
    }
    value
        .get("files")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|path| {
            let target = std::path::Path::new(path);
            target.is_file() && files::is_openable_output(target)
        })
        .collect()
}

fn remember_output(path: &str, scope: &path_gate::WriteScope) {
    let target = std::path::Path::new(path);
    if !scope.covers(target) && !grants::inside_roots(target) {
        eprintln!("[gate] an output outside the call's write scope was not remembered");
        return;
    }
    files::remember_produced(path);
    doc_watch::refresh_stamp(target);
}

pub(crate) fn remember_outputs(value: &Value, scope: &path_gate::WriteScope) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                match (key.as_str(), child) {
                    ("output", Value::String(path)) => remember_output(path, scope),
                    ("outputs", Value::Array(items)) => {
                        for item in items {
                            if let Value::String(path) = item {
                                remember_output(path, scope);
                            }
                        }
                    }
                    _ => remember_outputs(child, scope),
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                remember_outputs(item, scope);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn rpc_cancel(app: AppHandle, target: String) -> Result<Value, RpcError> {
    sidecar::call(
        &app,
        uuid::Uuid::new_v4().to_string(),
        "cancel".to_string(),
        serde_json::json!({ "target": target }),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_nested_outputs_inside_the_write_scope_only() {
        let base = std::path::PathBuf::from("C:/vivepdf-scope-test/out");
        let stray = std::path::PathBuf::from("C:/vivepdf-scope-test/elsewhere/d.pdf");
        let mut scope = path_gate::WriteScope::default();
        scope.add(&base.join("a.pdf"), false);
        let value = serde_json::json!({
            "steps": [{ "output": base.join("a.pdf") }],
            "outputs": [base.join("b.pdf"), stray]
        });

        remember_outputs(&value, &scope);

        assert!(files::was_produced(&base.join("a.pdf")));
        assert!(files::was_produced(&base.join("b.pdf")));
        assert!(!files::was_produced(&stray));
    }

    #[test]
    fn reads_the_folders_a_search_answer_lists() {
        let value = serde_json::json!({
            "folders": [{ "path": "C:/Docs", "files": 3 }, { "files": 1 }, { "path": 4 }],
            "database": "C:/data/search.db"
        });

        assert_eq!(search_folders(&value), vec!["C:/Docs"]);
        assert!(search_folders(&serde_json::json!({ "stats": {} })).is_empty());
    }

    #[test]
    fn only_openable_files_a_clipboard_answer_lists_are_granted() {
        let base = std::env::temp_dir().join(format!("vivepdf-clip-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let pdf = base.join("a.pdf");
        let script = base.join("run.bat");
        std::fs::write(&pdf, b"%PDF").unwrap();
        std::fs::write(&script, b"x").unwrap();
        let listed = |kind: &str| {
            serde_json::json!({
                "kind": kind,
                "files": [pdf, script, base, base.join("gone.pdf"), 7]
            })
        };

        let files = listed("files");
        let granted = clipboard_files(&files);
        let picture = listed("image");
        let ignored = clipboard_files(&picture);

        assert_eq!(granted, vec![pdf.to_str().unwrap()]);
        assert!(ignored.is_empty());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn parses_result_line() {
        let line = r#"{"id":"a","result":{"pageCount":3}}"#;
        let message: IncomingMessage = serde_json::from_str(line).unwrap();
        assert_eq!(message.id.as_deref(), Some("a"));
        assert!(message.error.is_none());
        assert_eq!(message.result.unwrap()["pageCount"], 3);
    }

    #[test]
    fn parses_error_line() {
        let line = r#"{"id":"b","error":{"code":"NEEDS_PASSWORD","message":"x","data":{"wrongPassword":false}}}"#;
        let message: IncomingMessage = serde_json::from_str(line).unwrap();
        let error = message.error.unwrap();
        assert_eq!(error.code, "NEEDS_PASSWORD");
        assert_eq!(error.data.unwrap()["wrongPassword"], false);
    }

    #[test]
    fn parses_progress_line() {
        let line = r#"{"id":"c","progress":0.5,"message":"k","detail":{"current":1}}"#;
        let message: IncomingMessage = serde_json::from_str(line).unwrap();
        assert_eq!(message.progress, Some(0.5));
        assert_eq!(message.message.as_deref(), Some("k"));
    }

    #[test]
    fn serializes_request_line() {
        let params = serde_json::json!({ "path": "a.pdf" });
        let request = OutgoingRequest {
            id: "1",
            method: "info.get",
            params: &params,
        };
        let text = serde_json::to_string(&request).unwrap();
        assert_eq!(
            text,
            r#"{"id":"1","method":"info.get","params":{"path":"a.pdf"}}"#
        );
    }
}

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::doc_watch;
use crate::files;
use crate::sidecar;

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
    let watched = doc_watch::begin_call(&params);
    let result = sidecar::call(&app, id, method, params).await;
    if let Ok(value) = &result {
        remember_outputs(value);
    }
    doc_watch::end_call(watched);
    result
}

fn remember_output(path: &str) {
    files::remember_produced(path);
    doc_watch::refresh_stamp(std::path::Path::new(path));
}

pub(crate) fn remember_outputs(value: &Value) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                match (key.as_str(), child) {
                    ("output", Value::String(path)) => remember_output(path),
                    ("outputs", Value::Array(items)) => {
                        for item in items {
                            if let Value::String(path) = item {
                                remember_output(path);
                            }
                        }
                    }
                    _ => remember_outputs(child),
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                remember_outputs(item);
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
    fn remembers_nested_outputs() {
        let value = serde_json::json!({
            "steps": [{ "output": "C:/out/a.pdf" }],
            "outputs": ["C:/out/b.pdf", "C:/out/c.pdf"]
        });
        remember_outputs(&value);
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

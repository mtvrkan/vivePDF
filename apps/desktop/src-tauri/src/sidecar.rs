use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

use crate::rpc::{IncomingMessage, OutgoingRequest, ProgressEvent, RpcError};

const ENGINE_DIR: &str = "engine";
const ENGINE_EXECUTABLE: &str = if cfg!(windows) {
    "vivepdf-sidecar.exe"
} else {
    "vivepdf-sidecar"
};
const MAX_SPAWN_ATTEMPTS: u32 = 3;
#[cfg(debug_assertions)]
const DEV_SIDECAR_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../sidecar");
const DEV_RESOURCES_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/resources");

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, RpcError>>>>>;

#[derive(Default)]
pub struct Sidecar {
    child: Mutex<Option<CommandChild>>,
    pending: Pending,
    spawn_attempts: Mutex<u32>,
    shutdown_requested: Mutex<bool>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub async fn call<R: Runtime>(
    app: &AppHandle<R>,
    id: String,
    method: String,
    params: Value,
) -> Result<Value, RpcError> {
    ensure_running(app)?;
    let state = app.state::<Sidecar>();

    let (tx, rx) = oneshot::channel();
    lock(&state.pending).insert(id.clone(), tx);

    let request = OutgoingRequest {
        id: &id,
        method: &method,
        params: &params,
    };
    let mut line = serde_json::to_string(&request)
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    line.push('\n');

    let written = match lock(&state.child).as_mut() {
        Some(child) => child
            .write(line.as_bytes())
            .map_err(|error| RpcError::new("SIDECAR_DIED", error.to_string())),
        None => Err(RpcError::new(
            "SIDECAR_UNAVAILABLE",
            "sidecar is not running",
        )),
    };
    if let Err(error) = written {
        lock(&state.pending).remove(&id);
        return Err(error);
    }

    rx.await.unwrap_or_else(|_| {
        Err(RpcError::new(
            "SIDECAR_DIED",
            "sidecar exited before responding",
        ))
    })
}

pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<Sidecar>();
    *lock(&state.shutdown_requested) = true;
    let child = lock(&state.child).take();
    if let Some(child) = child {
        let _ = child.kill();
    }
}

fn ensure_running<R: Runtime>(app: &AppHandle<R>) -> Result<(), RpcError> {
    let state = app.state::<Sidecar>();
    let mut slot = lock(&state.child);
    if slot.is_some() {
        return Ok(());
    }
    {
        let mut attempts = lock(&state.spawn_attempts);
        if *attempts >= MAX_SPAWN_ATTEMPTS {
            return Err(RpcError::new(
                "SIDECAR_UNAVAILABLE",
                "sidecar failed to start repeatedly",
            ));
        }
        *attempts += 1;
    }

    let (mut events, child) = build_command(app)?.spawn().map_err(|error| {
        crate::diagnostics::log_sidecar(app, "error", &format!("spawn failed: {error}"));
        RpcError::new("SIDECAR_SPAWN_FAILED", error.to_string())
    })?;
    let pid = child.pid();
    crate::diagnostics::log_sidecar(app, "info", &format!("started (pid {pid})"));
    *slot = Some(child);
    drop(slot);

    let pending = state.pending.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => handle_stdout(&handle, &pending, &bytes),
                CommandEvent::Stderr(bytes) => {
                    if let Some(line) = stderr_line(&bytes) {
                        crate::diagnostics::log_sidecar(&handle, "error", &line);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    crate::diagnostics::log_sidecar(
                        &handle,
                        "warn",
                        &format!("terminated: {payload:?}"),
                    );
                    break;
                }
                CommandEvent::Error(error) => {
                    crate::diagnostics::log_sidecar(&handle, "error", &format!("error: {error}"));
                    break;
                }
                _ => {}
            }
        }
        let state = handle.state::<Sidecar>();
        {
            let mut slot = lock(&state.child);
            if slot.as_ref().map(CommandChild::pid) == Some(pid) {
                *slot = None;
            }
        }
        let failed: Vec<_> = lock(&pending).drain().collect();
        for (_, tx) in failed {
            let _ = tx.send(Err(RpcError::new("SIDECAR_DIED", "sidecar process exited")));
        }
        if !*lock(&state.shutdown_requested) {
            let _ = handle.emit("sidecar-died", ());
        }
    });
    Ok(())
}

fn stderr_line(bytes: &[u8]) -> Option<String> {
    let line = String::from_utf8_lossy(bytes).trim_end().to_string();
    (!line.trim().is_empty()).then_some(line)
}

fn handle_stdout<R: Runtime>(app: &AppHandle<R>, pending: &Pending, bytes: &[u8]) {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    let message: IncomingMessage = match serde_json::from_str(trimmed) {
        Ok(message) => message,
        Err(_) => {
            crate::diagnostics::log_sidecar(app, "warn", &format!("unparsable line: {trimmed}"));
            return;
        }
    };
    let Some(id) = message.id else {
        crate::diagnostics::log_sidecar(app, "warn", &format!("message without id: {trimmed}"));
        return;
    };
    if let Some(progress) = message.progress {
        let _ = app.emit(
            "rpc-progress",
            ProgressEvent {
                id,
                progress,
                message: message.message,
                detail: message.detail,
            },
        );
        return;
    }
    *lock(&app.state::<Sidecar>().spawn_attempts) = 0;
    if cfg!(debug_assertions) {
        eprintln!(
            "[sidecar] <- {id} {}",
            message
                .error
                .as_ref()
                .map_or("ok", |error| error.code.as_str())
        );
    }
    if let Some(tx) = lock(pending).remove(&id) {
        let outcome = match message.error {
            Some(error) => Err(error),
            None => Ok(message.result.unwrap_or(Value::Null)),
        };
        let _ = tx.send(outcome);
    }
}

#[cfg(debug_assertions)]
fn build_command<R: Runtime>(app: &AppHandle<R>) -> Result<Command, RpcError> {
    let command = match std::env::var("VIVEPDF_SIDECAR_DIR") {
        Ok(dir) => dev_command(app, &dir),
        Err(_) => dev_command(app, DEV_SIDECAR_DIR),
    };
    Ok(match resources_dir(app) {
        Some(dir) => command.env("VIVEPDF_RESOURCES_DIR", dir),
        None => command,
    })
}

#[cfg(not(debug_assertions))]
fn build_command<R: Runtime>(app: &AppHandle<R>) -> Result<Command, RpcError> {
    let dir = resources_dir(app)
        .ok_or_else(|| RpcError::new("SIDECAR_SPAWN_FAILED", "resource directory unavailable"))?;
    let program = engine_executable(Path::new(&dir));
    if !program.is_file() {
        return Err(RpcError::new(
            "SIDECAR_SPAWN_FAILED",
            format!("engine missing: {}", program.display()),
        ));
    }
    let working_dir = program
        .parent()
        .map_or_else(|| PathBuf::from(&dir), Path::to_path_buf);
    Ok(app
        .shell()
        .command(&program)
        .current_dir(working_dir)
        .env("VIVEPDF_RESOURCES_DIR", dir))
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn engine_executable(resource_dir: &Path) -> PathBuf {
    resource_dir.join(ENGINE_DIR).join(ENGINE_EXECUTABLE)
}

fn resources_dir<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    if cfg!(debug_assertions) {
        return Some(DEV_RESOURCES_DIR.to_string());
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(debug_assertions)]
fn dev_command<R: Runtime>(app: &AppHandle<R>, dir: &str) -> Command {
    app.shell()
        .command("uv")
        .args(["run", "--project", dir, "python", "-m", "vivepdf"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stderr_lines_keep_their_text_and_drop_blank_output() {
        assert_eq!(
            stderr_line(b"Traceback (most recent call last):\r\n").as_deref(),
            Some("Traceback (most recent call last):")
        );
        assert_eq!(stderr_line(b"   \n"), None);
        assert_eq!(stderr_line(b""), None);
        assert_eq!(
            stderr_line(&[0x66, 0xff, 0x6f]).as_deref(),
            Some("f\u{fffd}o")
        );
    }

    #[test]
    fn engine_executable_lives_in_the_engine_resource_folder() {
        let resource_dir = Path::new("install").join("resources");

        let program = engine_executable(&resource_dir);

        assert_eq!(
            program.parent(),
            Some(resource_dir.join("engine").as_path())
        );
        let expected = if cfg!(windows) {
            "vivepdf-sidecar.exe"
        } else {
            "vivepdf-sidecar"
        };
        assert_eq!(
            program.file_name().and_then(|name| name.to_str()),
            Some(expected)
        );
    }
}

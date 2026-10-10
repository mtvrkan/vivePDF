use tauri::plugin::TauriPlugin;
use tauri::Runtime;

#[cfg(not(feature = "e2e"))]
#[cfg_attr(not(windows), allow(dead_code))]
pub fn active() -> bool {
    false
}

#[cfg(feature = "e2e")]
#[cfg_attr(not(windows), allow(dead_code))]
pub fn active() -> bool {
    scripted::enabled(std::env::var(scripted::ENABLE_VAR).ok().as_deref())
}

#[cfg(not(feature = "e2e"))]
pub fn dialog_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_dialog::init()
}

#[cfg(feature = "e2e")]
pub fn dialog_plugin<R: Runtime>() -> TauriPlugin<R> {
    match scripted::answers_file(
        std::env::var(scripted::ENABLE_VAR).ok().as_deref(),
        std::env::var_os(scripted::ANSWERS_VAR),
    ) {
        Some(file) => scripted::init(file),
        None => tauri_plugin_dialog::init(),
    }
}

#[cfg(any(test, feature = "e2e"))]
#[cfg_attr(not(feature = "e2e"), allow(dead_code))]
pub mod scripted {
    use std::ffi::OsString;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use serde_json::Value;
    use tauri::plugin::{Builder, TauriPlugin};
    use tauri::{Manager, Runtime, State};

    pub const ENABLE_VAR: &str = "VIVEPDF_E2E";
    pub const ANSWERS_VAR: &str = "VIVEPDF_E2E_DIALOG_FILE";

    pub struct Answers {
        file: PathBuf,
        guard: Mutex<()>,
    }

    pub fn enabled(flag: Option<&str>) -> bool {
        flag == Some("1")
    }

    pub fn answers_file(flag: Option<&str>, file: Option<OsString>) -> Option<PathBuf> {
        if !enabled(flag) {
            return None;
        }
        file.filter(|value| !value.is_empty()).map(PathBuf::from)
    }

    pub fn log_file(answers: &Path) -> PathBuf {
        let mut name = answers.as_os_str().to_owned();
        name.push(".log");
        PathBuf::from(name)
    }

    pub fn take_answer(file: &Path, command: &str, options: &Value) -> Value {
        let queue: Vec<Value> = std::fs::read_to_string(file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        let (answer, rest) = match queue.split_first() {
            Some((first, rest)) => (first.clone(), rest.to_vec()),
            None => (Value::Null, Vec::new()),
        };
        if let Ok(text) = serde_json::to_string(&rest) {
            let _ = std::fs::write(file, text);
        }
        let entry = serde_json::json!({ "command": command, "options": options, "answer": answer });
        if let Ok(mut log) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_file(file))
        {
            let _ = writeln!(log, "{entry}");
        }
        answer
    }

    fn answer(state: &Answers, command: &str, options: &Value) -> Value {
        let _held = state
            .guard
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        take_answer(&state.file, command, options)
    }

    #[tauri::command]
    fn open(state: State<'_, Answers>, options: Value) -> Value {
        answer(&state, "open", &options)
    }

    #[tauri::command]
    fn save(state: State<'_, Answers>, options: Value) -> Value {
        answer(&state, "save", &options)
    }

    pub fn init<R: Runtime>(file: PathBuf) -> TauriPlugin<R> {
        Builder::new("dialog")
            .invoke_handler(tauri::generate_handler![open, save])
            .setup(move |app, _api| {
                app.manage(Answers {
                    file,
                    guard: Mutex::new(()),
                });
                Ok(())
            })
            .build()
    }
}

#[cfg(test)]
mod tests {
    use super::scripted::{answers_file, enabled, log_file, take_answer};
    use serde_json::{json, Value};
    use std::ffi::OsString;

    fn temp_file(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("vivepdf-dialog-seam-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn seam_stays_off_unless_the_flag_is_exactly_one() {
        assert!(!super::active());
        assert!(enabled(Some("1")));
        assert!(!enabled(Some("yes")));
        assert!(!enabled(None));
        let file = Some(OsString::from("answers.json"));
        assert_eq!(answers_file(None, file.clone()), None);
        assert_eq!(answers_file(Some("0"), file.clone()), None);
        assert_eq!(answers_file(Some("true"), file.clone()), None);
        assert_eq!(answers_file(Some("1"), None), None);
        assert_eq!(answers_file(Some("1"), Some(OsString::new())), None);
        assert_eq!(
            answers_file(Some("1"), file),
            Some(std::path::PathBuf::from("answers.json"))
        );
    }

    #[test]
    fn answers_are_served_in_order_then_cancel() {
        let file = temp_file("answers.json");
        std::fs::write(&file, r#"["C:\\a.pdf", ["C:\\b.pdf", "C:\\c.pdf"]]"#).unwrap();

        assert_eq!(take_answer(&file, "open", &json!({})), json!("C:\\a.pdf"));
        assert_eq!(
            take_answer(&file, "open", &json!({ "multiple": true })),
            json!(["C:\\b.pdf", "C:\\c.pdf"])
        );
        assert_eq!(take_answer(&file, "save", &json!({})), Value::Null);

        let log = std::fs::read_to_string(log_file(&file)).unwrap();
        let entries: Vec<Value> = log
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[1]["options"]["multiple"], json!(true));
        assert_eq!(entries[2]["command"], json!("save"));
        assert_eq!(entries[2]["answer"], Value::Null);
    }

    #[test]
    fn missing_or_broken_answer_file_cancels_the_dialog() {
        let missing = temp_file("missing.json");
        assert_eq!(take_answer(&missing, "open", &json!({})), Value::Null);

        let broken = temp_file("broken.json");
        std::fs::write(&broken, "not json").unwrap();
        assert_eq!(take_answer(&broken, "save", &json!({})), Value::Null);
    }
}

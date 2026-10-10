#[cfg(any(unix, test))]
use std::path::Path;
use std::path::PathBuf;

use serde::Serialize;

use crate::rpc::RpcError;

#[cfg(not(target_os = "macos"))]
pub const ENTRY_NAME: &str = "vivePDF";
pub const BACKGROUND_FLAG: &str = "--background";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutostartStatus {
    pub supported: bool,
    pub enabled: bool,
    pub tray_by_default: bool,
}

pub fn started_in_background<I, S>(arguments: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    arguments
        .into_iter()
        .any(|argument| argument.as_ref() == BACKGROUND_FLAG)
}

#[cfg(any(windows, test))]
pub fn windows_command(executable: &str) -> String {
    format!("\"{executable}\" {BACKGROUND_FLAG}")
}

#[cfg(any(all(unix, not(target_os = "macos")), test))]
fn desktop_exec_argument(value: &str) -> String {
    let mut quoted = String::from("\"");
    for character in value.chars() {
        match character {
            '"' | '`' | '$' => {
                quoted.push_str("\\\\");
                quoted.push(character);
            }
            '\\' => quoted.push_str("\\\\\\\\"),
            '%' => quoted.push_str("%%"),
            _ => quoted.push(character),
        }
    }
    quoted.push('"');
    quoted
}

#[cfg(any(all(unix, not(target_os = "macos")), test))]
fn single_line(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .collect()
}

#[cfg(any(all(unix, not(target_os = "macos")), test))]
pub fn desktop_entry(executable: &str, name: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName={}\nExec={} {BACKGROUND_FLAG}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
        single_line(name),
        desktop_exec_argument(executable)
    )
}

#[cfg(any(unix, test))]
fn xml_text(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| match character {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&apos;".to_string(),
            _ => character.to_string(),
        })
        .collect()
}

#[cfg(any(unix, test))]
pub fn launch_agent(executable: &str, label: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key>\n  <string>{}</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>{}</string>\n    <string>{BACKGROUND_FLAG}</string>\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n</dict>\n</plist>\n",
        xml_text(label),
        xml_text(executable)
    )
}

pub fn launch_target() -> Result<PathBuf, RpcError> {
    #[cfg(target_os = "linux")]
    if let Some(image) = std::env::var_os("APPIMAGE").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(image));
    }
    std::env::current_exe()
        .map_err(|_| RpcError::new("INTERNAL", "could not locate the application"))
}

#[cfg(any(unix, test))]
fn write_file(path: &Path, contents: &str) -> Result<(), RpcError> {
    let failed = |_| RpcError::new("INTERNAL", "could not write the start-up entry");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(failed)?;
    }
    std::fs::write(path, contents).map_err(failed)
}

#[cfg(any(unix, test))]
fn remove_file(path: &Path) -> Result<(), RpcError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(RpcError::new(
            "INTERNAL",
            "could not remove the start-up entry",
        )),
    }
}

#[cfg(any(unix, test))]
pub fn file_entry_set(path: &Path, contents: &str, enabled: bool) -> Result<bool, RpcError> {
    if enabled {
        write_file(path, contents)?;
    } else {
        remove_file(path)?;
    }
    Ok(path.is_file())
}

#[cfg(windows)]
mod platform {
    use winreg::enums::{RegType::REG_BINARY, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::{RegKey, RegValue};

    use super::{launch_target, windows_command, ENTRY_NAME};
    use crate::rpc::RpcError;

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const APPROVED_KEY: &str =
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
    const APPROVED_ENABLED: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    fn failed(_: std::io::Error) -> RpcError {
        RpcError::new("INTERNAL", "could not change the start-up entry")
    }

    fn approved() -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(APPROVED_KEY, KEY_READ)
            .and_then(|key| key.get_raw_value(ENTRY_NAME))
            .map(|value| value.bytes.first().is_none_or(|flag| flag & 1 == 0))
            .unwrap_or(true)
    }

    pub fn enabled() -> bool {
        let registered = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN_KEY, KEY_READ)
            .and_then(|key| key.get_value::<String, _>(ENTRY_NAME))
            .is_ok();
        registered && approved()
    }

    pub fn set(enabled: bool) -> Result<(), RpcError> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            let executable = launch_target()?.to_string_lossy().to_string();
            let (run, _) = user.create_subkey(RUN_KEY).map_err(failed)?;
            run.set_value(ENTRY_NAME, &windows_command(&executable))
                .map_err(failed)?;
            if let Ok(key) = user.open_subkey_with_flags(APPROVED_KEY, KEY_SET_VALUE) {
                key.set_raw_value(
                    ENTRY_NAME,
                    &RegValue {
                        vtype: REG_BINARY,
                        bytes: APPROVED_ENABLED.to_vec(),
                    },
                )
                .map_err(failed)?;
            }
            return Ok(());
        }
        if let Ok(run) = user.open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE) {
            match run.delete_value(ENTRY_NAME) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(failed(error)),
            }
        }
        if let Ok(key) = user.open_subkey_with_flags(APPROVED_KEY, KEY_SET_VALUE) {
            let _ = key.delete_value(ENTRY_NAME);
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::PathBuf;

    use super::{file_entry_set, launch_agent, launch_target};
    use crate::rpc::RpcError;

    const LABEL: &str = "com.vivepdf.desktop.autostart";

    fn entry() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library/LaunchAgents")
                .join(format!("{LABEL}.plist"))
        })
    }

    pub fn enabled() -> bool {
        entry().is_some_and(|path| path.is_file())
    }

    pub fn set(enabled: bool) -> Result<(), RpcError> {
        let path = entry().ok_or_else(|| RpcError::new("UNSUPPORTED", "no home folder"))?;
        let executable = launch_target()?.to_string_lossy().to_string();
        file_entry_set(&path, &launch_agent(&executable, LABEL), enabled).map(|_| ())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use std::path::PathBuf;

    use super::{desktop_entry, file_entry_set, launch_target, ENTRY_NAME};
    use crate::rpc::RpcError;

    fn entry() -> Option<PathBuf> {
        std::env::var_os("XDG_CONFIG_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .map(|config| config.join("autostart").join("vivepdf.desktop"))
    }

    pub fn enabled() -> bool {
        entry().is_some_and(|path| path.is_file())
    }

    pub fn set(enabled: bool) -> Result<(), RpcError> {
        let path = entry().ok_or_else(|| RpcError::new("UNSUPPORTED", "no home folder"))?;
        let executable = launch_target()?.to_string_lossy().to_string();
        file_entry_set(&path, &desktop_entry(&executable, ENTRY_NAME), enabled).map(|_| ())
    }
}

#[tauri::command]
pub fn autostart_status() -> AutostartStatus {
    AutostartStatus {
        supported: true,
        enabled: platform::enabled(),
        tray_by_default: cfg!(any(windows, target_os = "macos")),
    }
}

#[tauri::command]
pub fn autostart_set(enabled: bool) -> Result<AutostartStatus, RpcError> {
    platform::set(enabled)?;
    Ok(autostart_status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_flag_is_detected_anywhere_in_the_arguments() {
        assert!(started_in_background(["C:\\a.pdf", "--background"]));
        assert!(!started_in_background(["--tool", "merge"]));
        assert!(!started_in_background(["--background-ish"]));
    }

    #[test]
    fn windows_command_quotes_a_path_with_spaces() {
        assert_eq!(
            windows_command("C:\\Users\\John Smith\\AppData\\Local\\vivePDF\\vivepdf.exe"),
            "\"C:\\Users\\John Smith\\AppData\\Local\\vivePDF\\vivepdf.exe\" --background"
        );
    }

    #[test]
    fn desktop_entry_quotes_and_escapes_the_executable() {
        let entry = desktop_entry("/home/me/My Apps/vive$PDF 100%.AppImage", "vivePDF\nX=1");
        assert!(
            entry.contains("Exec=\"/home/me/My Apps/vive\\\\$PDF 100%%.AppImage\" --background\n")
        );
        assert!(entry.contains("Name=vivePDFX=1\n"));
        assert_eq!(
            entry
                .lines()
                .filter(|line| line.starts_with("Exec="))
                .count(),
            1
        );
    }

    #[test]
    fn launch_agent_escapes_xml() {
        let plist = launch_agent("/Applications/A&B <x>.app/Contents/MacOS/vivepdf", "label");
        assert!(plist.contains(
            "<string>/Applications/A&amp;B &lt;x&gt;.app/Contents/MacOS/vivepdf</string>"
        ));
        assert!(plist.contains("<string>--background</string>"));
        assert!(plist.contains("<key>RunAtLoad</key>\n  <true/>"));
    }

    #[test]
    fn file_entry_is_written_and_removed() {
        let directory =
            std::env::temp_dir().join(format!("vivepdf-autostart-{}", uuid::Uuid::new_v4()));
        let path = directory.join("autostart").join("vivepdf.desktop");
        assert!(file_entry_set(&path, "[Desktop Entry]\n", true).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "[Desktop Entry]\n");
        assert!(!file_entry_set(&path, "", false).unwrap());
        assert!(!file_entry_set(&path, "", false).unwrap());
        let _ = std::fs::remove_dir_all(directory);
    }
}

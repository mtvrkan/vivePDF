use serde::Deserialize;

use crate::rpc::RpcError;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellEntry {
    pub id: String,
    pub label: String,
    pub tool: String,
    pub extensions: Vec<String>,
}

#[cfg(any(windows, test))]
pub const MENU_KEY: &str = "vivePDF";

pub fn normalize_extension(value: &str) -> String {
    value.trim().trim_start_matches('.').to_ascii_lowercase()
}

#[cfg(any(windows, test))]
pub fn menu_path(extension: &str) -> String {
    format!(
        "SystemFileAssociations\\.{}\\shell\\{}",
        normalize_extension(extension),
        MENU_KEY
    )
}

#[cfg(any(windows, test))]
pub fn command_line(executable: &str, tool: &str) -> String {
    format!("\"{executable}\" --tool \"{tool}\" \"%1\"")
}

fn is_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

fn is_extension_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 8
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn is_display_text(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 64 && !value.chars().any(|c| c.is_control())
}

fn validate_entries(title: &str, entries: &[ShellEntry]) -> Result<(), RpcError> {
    if !is_display_text(title) {
        return Err(RpcError::new(
            "VALIDATION",
            "invalid shell integration title",
        ));
    }
    for entry in entries {
        if !is_slug(&entry.id) {
            return Err(RpcError::new(
                "VALIDATION",
                format!("invalid shell entry id: {}", entry.id),
            ));
        }
        if !is_slug(&entry.tool) {
            return Err(RpcError::new(
                "VALIDATION",
                format!("invalid shell entry tool: {}", entry.tool),
            ));
        }
        if !is_display_text(&entry.label) {
            return Err(RpcError::new(
                "VALIDATION",
                format!("invalid shell entry label: {}", entry.label),
            ));
        }
        for extension in &entry.extensions {
            if !is_extension_code(&normalize_extension(extension)) {
                return Err(RpcError::new(
                    "VALIDATION",
                    format!("invalid shell entry extension: {extension}"),
                ));
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
mod registry {
    use std::collections::BTreeMap;

    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    use super::{command_line, menu_path, normalize_extension, ShellEntry};

    fn classes() -> std::io::Result<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey("Software\\Classes")
            .map(|(key, _)| key)
    }

    pub fn enabled() -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(format!("Software\\Classes\\{}", menu_path("pdf")))
            .is_ok()
    }

    pub fn stale() -> bool {
        let Ok(executable) = std::env::current_exe() else {
            return false;
        };
        let Ok(recorded) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(format!("Software\\Classes\\{}", menu_path("pdf")))
            .and_then(|key| key.get_value::<String, _>("Executable"))
        else {
            return true;
        };
        recorded.to_lowercase() != executable.to_string_lossy().to_lowercase()
    }

    pub fn apply(title: &str, entries: &[ShellEntry]) -> std::io::Result<()> {
        let executable = std::env::current_exe()?.to_string_lossy().to_string();
        let icon = format!("\"{executable}\",0");
        let classes = classes()?;
        let mut by_extension: BTreeMap<String, Vec<&ShellEntry>> = BTreeMap::new();
        for entry in entries {
            for extension in &entry.extensions {
                by_extension
                    .entry(normalize_extension(extension))
                    .or_default()
                    .push(entry);
            }
        }
        for (extension, items) in by_extension {
            match classes.delete_subkey_all(menu_path(&extension)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            let (menu, _) = classes.create_subkey(menu_path(&extension))?;
            menu.set_value("MUIVerb", &title)?;
            menu.set_value("Icon", &icon)?;
            menu.set_value("SubCommands", &"")?;
            menu.set_value("Executable", &executable)?;
            let (shell, _) = menu.create_subkey("shell")?;
            for (index, item) in items.iter().enumerate() {
                let (verb, _) = shell.create_subkey(format!("{index:02}_{}", item.id))?;
                verb.set_value("MUIVerb", &item.label)?;
                verb.set_value("Icon", &icon)?;
                verb.set_value("MultiSelectModel", &"Player")?;
                let (command, _) = verb.create_subkey("command")?;
                command.set_value("", &command_line(&executable, &item.tool))?;
            }
        }
        Ok(())
    }

    pub fn remove(extensions: &[String]) -> std::io::Result<()> {
        let classes = classes()?;
        for extension in extensions {
            match classes.delete_subkey_all(menu_path(extension)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn shell_integration_supported() -> bool {
    cfg!(windows)
}

#[tauri::command]
pub fn shell_integration_stale() -> bool {
    #[cfg(windows)]
    {
        !crate::e2e::active() && registry::enabled() && registry::stale()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub fn shell_integration_enabled() -> bool {
    #[cfg(windows)]
    {
        registry::enabled()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub fn set_shell_integration(
    enabled: bool,
    title: String,
    entries: Vec<ShellEntry>,
) -> Result<bool, RpcError> {
    validate_entries(&title, &entries)?;
    #[cfg(windows)]
    {
        let result = if enabled {
            registry::apply(&title, &entries)
        } else {
            let extensions: Vec<String> = entries
                .iter()
                .flat_map(|entry| entry.extensions.iter().cloned())
                .collect();
            registry::remove(&extensions)
        };
        result.map_err(|error| {
            let code = match error.kind() {
                std::io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
                std::io::ErrorKind::NotFound => "FILE_NOT_FOUND",
                _ => "INTERNAL",
            };
            RpcError::new(code, error.to_string())
        })?;
        Ok(registry::enabled())
    }
    #[cfg(not(windows))]
    {
        let _ = (enabled, title, entries);
        Err(RpcError::new(
            "UNSUPPORTED",
            "shell integration is only available on Windows",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_path_normalizes_extension() {
        assert_eq!(
            menu_path(".PDF"),
            "SystemFileAssociations\\.pdf\\shell\\vivePDF"
        );
    }

    #[test]
    fn command_line_quotes_executable_and_target() {
        assert_eq!(
            command_line("C:\\Apps\\vivepdf.exe", "compress"),
            "\"C:\\Apps\\vivepdf.exe\" --tool \"compress\" \"%1\""
        );
    }

    fn entry(id: &str, tool: &str, label: &str, extensions: &[&str]) -> ShellEntry {
        ShellEntry {
            id: id.to_string(),
            label: label.to_string(),
            tool: tool.to_string(),
            extensions: extensions.iter().map(|item| item.to_string()).collect(),
        }
    }

    #[test]
    fn validate_entries_accepts_well_formed_input() {
        let entries = vec![entry("compress-pdf", "compress", "Compress PDF", &["pdf"])];
        assert!(validate_entries("vivePDF", &entries).is_ok());
    }

    #[test]
    fn validate_entries_rejects_invalid_tool_slug() {
        let entries = vec![entry("compress", "Compress Tool!", "Compress", &["pdf"])];
        assert!(validate_entries("vivePDF", &entries).is_err());
    }

    #[test]
    fn validate_entries_rejects_invalid_extension() {
        let entries = vec![entry("compress", "compress", "Compress", &["p d f"])];
        assert!(validate_entries("vivePDF", &entries).is_err());
    }

    #[test]
    fn validate_entries_rejects_oversized_label() {
        let long_label = "x".repeat(65);
        let entries = vec![entry("compress", "compress", &long_label, &["pdf"])];
        assert!(validate_entries("vivePDF", &entries).is_err());
    }

    #[test]
    fn validate_entries_rejects_control_chars_in_title() {
        let entries = vec![entry("compress", "compress", "Compress", &["pdf"])];
        assert!(validate_entries("vive\nPDF", &entries).is_err());
    }
}

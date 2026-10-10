use crate::rpc::RpcError;

#[cfg(windows)]
pub const PROG_ID: &str = "vivePDF.Document";
#[cfg(windows)]
pub const CAPABILITIES_PATH: &str = "Software\\vivePDF\\Capabilities";
#[cfg(any(windows, test))]
pub const DOCUMENT_ICON_NAME: &str = "pdf-document.ico";
#[cfg(windows)]
const DOCUMENT_ICON: &[u8] = include_bytes!("../icons/pdf-document.ico");

#[cfg(any(windows, test))]
pub fn open_command_line(executable: &str) -> String {
    format!("\"{executable}\" \"%1\"")
}

#[cfg(any(windows, test))]
pub fn icon_value(path: &str) -> String {
    format!("\"{path}\",0")
}

#[cfg(any(windows, test))]
pub fn document_icon_path(data_dir: Option<std::path::PathBuf>) -> Option<std::path::PathBuf> {
    data_dir.map(|dir| dir.join(DOCUMENT_ICON_NAME))
}

#[cfg(windows)]
pub fn install_document_icon(path: &std::path::Path) -> Option<String> {
    if std::fs::read(path).ok().as_deref() != Some(DOCUMENT_ICON) {
        std::fs::create_dir_all(path.parent()?).ok()?;
        std::fs::write(path, DOCUMENT_ICON).ok()?;
    }
    Some(icon_value(&path.to_string_lossy()))
}

#[cfg(windows)]
pub fn current_document_icon(path: &std::path::Path) -> Option<String> {
    (std::fs::read(path).ok()?.as_slice() == DOCUMENT_ICON)
        .then(|| icon_value(&path.to_string_lossy()))
}

#[cfg(any(windows, test))]
pub fn application_key(executable: &str) -> String {
    let file_name = executable
        .rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("vivepdf.exe");
    format!("Applications\\{file_name}")
}

#[cfg(windows)]
mod registry {
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    use super::{
        application_key, current_document_icon, document_icon_path, icon_value,
        install_document_icon, open_command_line, CAPABILITIES_PATH, PROG_ID,
    };

    fn root() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    fn classes() -> std::io::Result<RegKey> {
        root()
            .create_subkey("Software\\Classes")
            .map(|(key, _)| key)
    }

    fn ignore_missing(result: std::io::Result<()>) -> std::io::Result<()> {
        match result {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }

    fn announce_change() {
        // SAFETY: SHCNE_ASSOCCHANGED with SHCNF_IDLIST takes no item pointers, so both are None.
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
        }
    }

    fn document_icon_location() -> Option<std::path::PathBuf> {
        document_icon_path(crate::font_source::data_dir(|key| std::env::var(key).ok()))
    }

    pub fn enabled() -> bool {
        root()
            .open_subkey(format!(
                "Software\\Classes\\{PROG_ID}\\shell\\open\\command"
            ))
            .is_ok()
    }

    pub fn stale() -> bool {
        let Ok(executable) = std::env::current_exe() else {
            return false;
        };
        let Ok(command) = root()
            .open_subkey(format!(
                "Software\\Classes\\{PROG_ID}\\shell\\open\\command"
            ))
            .and_then(|key| key.get_value::<String, _>(""))
        else {
            return false;
        };
        if command.to_lowercase() != open_command_line(&executable.to_string_lossy()).to_lowercase()
        {
            return true;
        }
        let icon = root()
            .open_subkey(format!("Software\\Classes\\{PROG_ID}\\DefaultIcon"))
            .and_then(|key| key.get_value::<String, _>(""))
            .unwrap_or_default();
        document_icon_location()
            .and_then(|path| current_document_icon(&path))
            .is_none_or(|expected| icon.to_lowercase() != expected.to_lowercase())
    }

    pub fn apply(name: &str, description: &str) -> std::io::Result<()> {
        let executable = std::env::current_exe()?.to_string_lossy().to_string();
        let icon = icon_value(&executable);
        let document_icon = document_icon_location()
            .and_then(|path| install_document_icon(&path))
            .unwrap_or_else(|| icon.clone());
        let classes = classes()?;
        let (prog, _) = classes.create_subkey(PROG_ID)?;
        prog.set_value("", &description)?;
        prog.set_value("FriendlyTypeName", &description)?;
        let (default_icon, _) = prog.create_subkey("DefaultIcon")?;
        default_icon.set_value("", &document_icon)?;
        let (command, _) = prog.create_subkey("shell\\open\\command")?;
        command.set_value("", &open_command_line(&executable))?;
        let (open_with, _) = classes.create_subkey(".pdf\\OpenWithProgids")?;
        open_with.set_value(PROG_ID, &"")?;
        let (application, _) = classes.create_subkey(application_key(&executable))?;
        application.set_value("FriendlyAppName", &name)?;
        let (application_icon, _) = application.create_subkey("DefaultIcon")?;
        application_icon.set_value("", &icon)?;
        let (application_command, _) = application.create_subkey("shell\\open\\command")?;
        application_command.set_value("", &open_command_line(&executable))?;
        let (supported, _) = application.create_subkey("SupportedTypes")?;
        supported.set_value(".pdf", &"")?;
        let (capabilities, _) = root().create_subkey(CAPABILITIES_PATH)?;
        capabilities.set_value("ApplicationName", &name)?;
        capabilities.set_value("ApplicationDescription", &description)?;
        capabilities.set_value("ApplicationIcon", &icon)?;
        let (associations, _) = capabilities.create_subkey("FileAssociations")?;
        associations.set_value(".pdf", &PROG_ID)?;
        let (registered, _) = root().create_subkey("Software\\RegisteredApplications")?;
        registered.set_value(name, &CAPABILITIES_PATH)?;
        announce_change();
        Ok(())
    }

    pub fn remove(name: &str) -> std::io::Result<()> {
        let classes = classes()?;
        ignore_missing(classes.delete_subkey_all(PROG_ID))?;
        if let Ok(executable) = std::env::current_exe() {
            ignore_missing(
                classes.delete_subkey_all(application_key(&executable.to_string_lossy())),
            )?;
        }
        if let Ok(open_with) =
            classes.open_subkey_with_flags(".pdf\\OpenWithProgids", winreg::enums::KEY_SET_VALUE)
        {
            ignore_missing(open_with.delete_value(PROG_ID))?;
        }
        ignore_missing(root().delete_subkey_all(CAPABILITIES_PATH))?;
        if let Ok(registered) = root().open_subkey_with_flags(
            "Software\\RegisteredApplications",
            winreg::enums::KEY_SET_VALUE,
        ) {
            ignore_missing(registered.delete_value(name))?;
        }
        announce_change();
        Ok(())
    }
}

fn is_display_text(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 64 && !value.chars().any(|c| c.is_control())
}

#[tauri::command]
pub fn file_association_enabled() -> bool {
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
pub fn file_association_stale() -> bool {
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
pub fn set_file_association(
    enabled: bool,
    name: String,
    description: String,
) -> Result<bool, RpcError> {
    if !is_display_text(&name) || !is_display_text(&description) {
        return Err(RpcError::new("VALIDATION", "invalid file association text"));
    }
    #[cfg(windows)]
    {
        let result = if enabled {
            registry::apply(&name, &description)
        } else {
            registry::remove(&name)
        };
        result.map_err(|error| {
            let code = match error.kind() {
                std::io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
                _ => "INTERNAL",
            };
            RpcError::new(code, error.to_string())
        })?;
        Ok(registry::enabled())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err(RpcError::new(
            "UNSUPPORTED",
            "file association is only available on Windows",
        ))
    }
}

#[tauri::command]
pub fn open_default_apps_settings() -> Result<(), RpcError> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:defaultapps")
            .spawn()
            .map(|_| ())
            .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
    }
    #[cfg(not(windows))]
    {
        Err(RpcError::new("UNSUPPORTED", "only available on Windows"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_command_quotes_executable_and_target() {
        assert_eq!(
            open_command_line("C:\\Apps\\vivepdf.exe"),
            "\"C:\\Apps\\vivepdf.exe\" \"%1\""
        );
    }

    #[test]
    fn icon_value_quotes_the_path_and_picks_the_first_icon() {
        assert_eq!(
            icon_value("C:\\Users\\a b\\vivePDF\\pdf-document.ico"),
            "\"C:\\Users\\a b\\vivePDF\\pdf-document.ico\",0"
        );
    }

    #[test]
    fn document_icon_lives_in_the_data_directory() {
        let dir = std::path::PathBuf::from("data");
        assert_eq!(
            document_icon_path(Some(dir.clone())),
            Some(dir.join("pdf-document.ico"))
        );
        assert_eq!(document_icon_path(None), None);
    }

    #[cfg(windows)]
    #[test]
    fn document_icon_is_written_once_and_repaired_when_changed() {
        let dir = std::env::temp_dir().join(format!("vivepdf-doc-icon-{}", std::process::id()));
        let path = dir.join(DOCUMENT_ICON_NAME);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(current_document_icon(&path), None);

        let value = install_document_icon(&path).expect("icon written");
        assert_eq!(value, icon_value(&path.to_string_lossy()));
        assert_eq!(std::fs::read(&path).unwrap(), DOCUMENT_ICON);
        assert_eq!(current_document_icon(&path), Some(value.clone()));

        std::fs::write(&path, b"broken").unwrap();
        assert_eq!(current_document_icon(&path), None);
        assert_eq!(install_document_icon(&path), Some(value));
        assert_eq!(std::fs::read(&path).unwrap(), DOCUMENT_ICON);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn application_key_uses_the_executable_file_name() {
        assert_eq!(
            application_key("C:\\Apps\\vivepdf.exe"),
            "Applications\\vivepdf.exe"
        );
        assert_eq!(
            application_key("/opt/vivepdf/vivepdf"),
            "Applications\\vivepdf"
        );
        assert_eq!(application_key(""), "Applications\\vivepdf.exe");
    }

    #[test]
    fn display_text_rejects_control_characters() {
        assert!(is_display_text("vivePDF"));
        assert!(!is_display_text("vive\nPDF"));
        assert!(!is_display_text(""));
    }
}

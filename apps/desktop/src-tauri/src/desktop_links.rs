use crate::rpc::RpcError;

#[cfg(windows)]
pub const APP_USER_MODEL_ID: &str = "com.vivepdf.desktop";

#[cfg(any(windows, test))]
pub fn shortcut_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim();
    let base = if trimmed.is_empty() {
        "vivePDF"
    } else {
        trimmed
    };
    format!("{base}.lnk")
}

#[cfg(windows)]
mod shell {
    use std::path::PathBuf;

    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FOLDERID_SendTo, IShellLinkW, SHAddToRecentDocs, SHGetKnownFolderPath,
        SetCurrentProcessExplicitAppUserModelID, ShellLink, KF_FLAG_DEFAULT, SHARD_PATHW,
    };

    use super::{shortcut_file_name, APP_USER_MODEL_ID};

    fn initialise() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
    }

    pub fn declare_app_id() {
        initialise();
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(APP_USER_MODEL_ID));
        }
    }

    pub fn remember_document(path: &str) {
        initialise();
        if path.is_empty() {
            unsafe {
                SHAddToRecentDocs(SHARD_PATHW.0 as u32, None);
            }
            return;
        }
        let wide = HSTRING::from(path);
        unsafe {
            SHAddToRecentDocs(SHARD_PATHW.0 as u32, Some(wide.as_ptr() as *const _));
        }
    }

    pub fn send_to_directory() -> std::io::Result<PathBuf> {
        initialise();
        unsafe {
            let raw = SHGetKnownFolderPath(&FOLDERID_SendTo, KF_FLAG_DEFAULT, None)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let path = PathBuf::from(raw.to_string().map_err(std::io::Error::other)?);
            CoTaskMemFree(Some(raw.0 as *const _));
            Ok(path)
        }
    }

    pub fn shortcut_path(name: &str) -> std::io::Result<PathBuf> {
        Ok(send_to_directory()?.join(shortcut_file_name(name)))
    }

    pub fn exists(name: &str) -> bool {
        shortcut_path(name)
            .map(|path| path.is_file())
            .unwrap_or(false)
    }

    pub fn create(name: &str, description: &str) -> std::io::Result<()> {
        initialise();
        let executable = std::env::current_exe()?;
        let target = shortcut_path(name)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            link.SetPath(&HSTRING::from(executable.as_os_str()))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            link.SetDescription(&HSTRING::from(description))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            if let Some(parent) = executable.parent() {
                link.SetWorkingDirectory(&HSTRING::from(parent.as_os_str()))
                    .map_err(|error| std::io::Error::other(error.to_string()))?;
            }
            link.SetIconLocation(&HSTRING::from(executable.as_os_str()), 0)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let persist: IPersistFile = link
                .cast()
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            persist
                .Save(&HSTRING::from(target.as_os_str()), true)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
        }
        Ok(())
    }

    pub fn remove(name: &str) -> std::io::Result<()> {
        let target = shortcut_path(name)?;
        match std::fs::remove_file(target) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }
}

fn is_display_text(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 64 && !value.chars().any(|c| c.is_control())
}

pub fn declare_app_id() {
    #[cfg(windows)]
    {
        shell::declare_app_id();
    }
}

#[tauri::command]
pub fn send_to_supported() -> bool {
    cfg!(windows)
}

#[tauri::command]
pub fn send_to_enabled(name: String) -> bool {
    #[cfg(windows)]
    {
        shell::exists(&name)
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        false
    }
}

#[tauri::command]
pub fn set_send_to(enabled: bool, name: String, description: String) -> Result<bool, RpcError> {
    if !is_display_text(&name) || !is_display_text(&description) {
        return Err(RpcError::new("VALIDATION", "invalid shortcut text"));
    }
    #[cfg(windows)]
    {
        let result = if enabled {
            shell::create(&name, &description)
        } else {
            shell::remove(&name)
        };
        result.map_err(|error| {
            let code = match error.kind() {
                std::io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
                std::io::ErrorKind::NotFound => "FILE_NOT_FOUND",
                _ => "INTERNAL",
            };
            RpcError::new(code, error.to_string())
        })?;
        Ok(shell::exists(&name))
    }
    #[cfg(not(windows))]
    {
        let _ = (enabled, description);
        Err(RpcError::new(
            "UNSUPPORTED",
            "Send to is only available on Windows",
        ))
    }
}

#[tauri::command]
pub fn remember_recent_document(path: String) {
    #[cfg(windows)]
    {
        shell::remember_document(&path);
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_name_drops_path_characters_and_adds_the_extension() {
        assert_eq!(shortcut_file_name("vivePDF"), "vivePDF.lnk");
        assert_eq!(shortcut_file_name("vive/PDF:*"), "vivePDF.lnk");
        assert_eq!(shortcut_file_name("   "), "vivePDF.lnk");
        assert_eq!(shortcut_file_name(""), "vivePDF.lnk");
    }

    #[test]
    fn display_text_rejects_control_characters() {
        assert!(is_display_text("vivePDF"));
        assert!(!is_display_text("vive\tPDF"));
        assert!(!is_display_text(""));
    }
}

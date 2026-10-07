use crate::rpc::RpcError;
use std::path::{Path, PathBuf};

fn validate_source(path: &str) -> Result<PathBuf, RpcError> {
    let target = PathBuf::from(path);
    if !target.is_file() {
        return Err(RpcError::new(
            "FILE_NOT_FOUND",
            format!("not a file: {path}"),
        ));
    }
    Ok(target)
}

#[cfg(windows)]
fn drag_file(hwnd: windows::Win32::Foundation::HWND, file: &Path) -> Result<bool, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::IDataObject;
    use windows::Win32::System::Ole::{IDropSource, DROPEFFECT_COPY, DROPEFFECT_NONE};
    use windows::Win32::UI::Shell::{
        BHID_DataObject, IShellItem, IShellItemArray, SHCreateItemFromParsingName,
        SHCreateShellItemArrayFromShellItem, SHDoDragDrop,
    };

    let wide: Vec<u16> = file.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 buffer that outlives every call below, and all
    // interface pointers are owned `windows` wrappers released on drop.
    unsafe {
        let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
            .map_err(|error| error.to_string())?;
        let items: IShellItemArray =
            SHCreateShellItemArrayFromShellItem(&item).map_err(|error| error.to_string())?;
        let data: IDataObject = items
            .BindToHandler(None, &BHID_DataObject)
            .map_err(|error| error.to_string())?;
        let effect = SHDoDragDrop(Some(hwnd), &data, None::<&IDropSource>, DROPEFFECT_COPY)
            .map_err(|error| error.to_string())?;
        Ok(effect != DROPEFFECT_NONE)
    }
}

#[cfg(windows)]
#[tauri::command]
pub async fn start_file_drag(window: tauri::WebviewWindow, path: String) -> Result<bool, RpcError> {
    let source = validate_source(&path)?;
    let hwnd = window
        .hwnd()
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    let handle = hwnd.0 as isize;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let hwnd = windows::Win32::Foundation::HWND(handle as *mut core::ffi::c_void);
            let _ = sender.send(drag_file(hwnd, &source));
        })
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    receiver
        .await
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
        .map_err(|message| RpcError::new("INTERNAL", message))
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn start_file_drag(_window: tauri::WebviewWindow, path: String) -> Result<bool, RpcError> {
    validate_source(&path)?;
    Err(RpcError::new("UNSUPPORTED", "unsupported"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_path_is_rejected() {
        let error = validate_source("Z:/definitely/not/here.pdf").unwrap_err();
        assert_eq!(error.code, "FILE_NOT_FOUND");
    }

    #[test]
    fn directory_is_rejected() {
        let error = validate_source(env!("CARGO_MANIFEST_DIR")).unwrap_err();
        assert_eq!(error.code, "FILE_NOT_FOUND");
    }

    #[test]
    fn existing_file_is_accepted() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        assert!(validate_source(&manifest.to_string_lossy()).is_ok());
    }
}

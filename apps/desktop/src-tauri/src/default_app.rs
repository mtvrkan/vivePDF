use serde::Serialize;

use crate::rpc::RpcError;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAppStatus {
    pub supported: bool,
    pub is_default: bool,
    pub current: Option<String>,
}

impl DefaultAppStatus {
    fn unsupported() -> Self {
        Self {
            supported: false,
            is_default: false,
            current: None,
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DefaultAppOutcome {
    Done,
    #[cfg_attr(not(windows), allow(dead_code))]
    Settings,
}

#[cfg(any(target_os = "macos", test))]
fn app_display_name(display_name: &str) -> String {
    display_name
        .strip_suffix(".app")
        .unwrap_or(display_name)
        .to_string()
}

#[cfg(any(windows, test))]
fn settings_uri(name: &str) -> String {
    format!(
        "ms-settings:defaultapps?registeredAppUser={}",
        urlencoding::encode(name)
    )
}

#[cfg(any(windows, test))]
fn same_executable(left: &str, right: &str) -> bool {
    let normalize = |path: &str| {
        path.trim()
            .trim_matches('"')
            .replace('/', "\\")
            .to_lowercase()
    };
    !left.trim().is_empty() && normalize(left) == normalize(right)
}

#[cfg(any(all(unix, not(target_os = "macos")), test))]
fn desktop_value<'a>(contents: &'a str, key: &str) -> Option<&'a str> {
    let mut in_entry = false;
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        if let Some((name, value)) = line.split_once('=') {
            if name.trim() == key {
                return Some(value.trim());
            }
        }
    }
    None
}

#[cfg(any(all(unix, not(target_os = "macos")), test))]
fn exec_program(contents: &str) -> Option<String> {
    let exec = desktop_value(contents, "Exec")?;
    let program = if let Some(rest) = exec.strip_prefix('"') {
        rest.split('"').next()?
    } else {
        exec.split_whitespace().next()?
    };
    let name = program.rsplit('/').next()?;
    (!name.is_empty()).then(|| name.to_string())
}

#[cfg(any(all(unix, not(target_os = "macos")), test))]
fn find_own_entry(entries: &[(String, String)], executable_name: &str) -> Option<String> {
    entries
        .iter()
        .find(|(_, contents)| exec_program(contents).as_deref() == Some(executable_name))
        .map(|(id, _)| id.clone())
}

#[cfg(any(all(unix, not(target_os = "macos")), test))]
fn entry_display_name(entries: &[(String, String)], id: &str) -> String {
    entries
        .iter()
        .find(|(entry, _)| entry == id)
        .and_then(|(_, contents)| desktop_value(contents, "Name"))
        .map(str::to_string)
        .unwrap_or_else(|| id.strip_suffix(".desktop").unwrap_or(id).to_string())
}

#[cfg(target_os = "macos")]
mod platform {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;

    use super::{app_display_name, DefaultAppOutcome, DefaultAppStatus};
    use crate::rpc::RpcError;

    #[link(name = "UniformTypeIdentifiers", kind = "framework")]
    extern "C" {}

    const PDF_TYPE: &str = "com.adobe.pdf";
    const BUNDLE_ID: &str = "com.vivepdf.desktop";
    const CANCEL_CODES: [isize; 2] = [3072, -128];

    fn workspace() -> Retained<AnyObject> {
        // SAFETY: +[NSWorkspace sharedWorkspace] takes no arguments and never returns nil.
        unsafe { msg_send![class!(NSWorkspace), sharedWorkspace] }
    }

    fn pdf_type() -> Option<Retained<AnyObject>> {
        let identifier = NSString::from_str(PDF_TYPE);
        // SAFETY: +[UTType typeWithIdentifier:] takes an NSString and returns a UTType or nil.
        unsafe { msg_send![class!(UTType), typeWithIdentifier: &*identifier] }
    }

    fn url_path(url: &AnyObject) -> Option<String> {
        // SAFETY: -[NSURL path] takes no arguments and returns an NSString or nil.
        let path: Option<Retained<NSString>> = unsafe { msg_send![url, path] };
        path.map(|path| path.to_string())
    }

    fn bundle_identifier(url: &AnyObject) -> Option<String> {
        // SAFETY: +[NSBundle bundleWithURL:] takes an NSURL and returns a bundle or nil.
        let bundle: Option<Retained<AnyObject>> =
            unsafe { msg_send![class!(NSBundle), bundleWithURL: url] };
        // SAFETY: -[NSBundle bundleIdentifier] takes no arguments and returns an NSString or nil.
        let identifier: Option<Retained<NSString>> =
            unsafe { msg_send![&*bundle?, bundleIdentifier] };
        identifier.map(|identifier| identifier.to_string())
    }

    fn display_name(url: &AnyObject) -> Option<String> {
        let path = NSString::from_str(&url_path(url)?);
        // SAFETY: +[NSFileManager defaultManager] takes no arguments and never returns nil.
        let manager: Retained<AnyObject> =
            unsafe { msg_send![class!(NSFileManager), defaultManager] };
        // SAFETY: -[NSFileManager displayNameAtPath:] takes an NSString and returns an NSString.
        let name: Retained<NSString> = unsafe { msg_send![&*manager, displayNameAtPath: &*path] };
        Some(app_display_name(&name.to_string()))
    }

    fn own_app() -> Option<Retained<AnyObject>> {
        // SAFETY: +[NSBundle mainBundle] takes no arguments and never returns nil.
        let main: Retained<AnyObject> = unsafe { msg_send![class!(NSBundle), mainBundle] };
        // SAFETY: -[NSBundle bundleURL] takes no arguments and returns an NSURL.
        let url: Retained<AnyObject> = unsafe { msg_send![&*main, bundleURL] };
        if url_path(&url).is_some_and(|path| path.ends_with(".app")) {
            return Some(url);
        }
        let identifier = NSString::from_str(BUNDLE_ID);
        // SAFETY: -[NSWorkspace URLForApplicationWithBundleIdentifier:] takes an NSString and returns an NSURL or nil.
        unsafe { msg_send![&*workspace(), URLForApplicationWithBundleIdentifier: &*identifier] }
    }

    pub fn status() -> DefaultAppStatus {
        let (Some(kind), Some(_)) = (pdf_type(), own_app()) else {
            return DefaultAppStatus::unsupported();
        };
        // SAFETY: -[NSWorkspace URLForApplicationToOpenContentType:] takes a UTType and returns an NSURL or nil.
        let current: Option<Retained<AnyObject>> =
            unsafe { msg_send![&*workspace(), URLForApplicationToOpenContentType: &*kind] };
        DefaultAppStatus {
            supported: true,
            is_default: current
                .as_deref()
                .and_then(bundle_identifier)
                .is_some_and(|identifier| identifier == BUNDLE_ID),
            current: current.as_deref().and_then(display_name),
        }
    }

    fn cancelled(error: &AnyObject) -> bool {
        // SAFETY: -[NSError code] takes no arguments and returns an NSInteger.
        let code: isize = unsafe { msg_send![error, code] };
        if CANCEL_CODES.contains(&code) {
            return true;
        }
        let key = NSString::from_str("NSUnderlyingError");
        // SAFETY: -[NSError userInfo] takes no arguments and returns an NSDictionary.
        let info: Retained<AnyObject> = unsafe { msg_send![error, userInfo] };
        // SAFETY: -[NSDictionary objectForKey:] takes a key and returns the value or nil.
        let underlying: Option<Retained<AnyObject>> =
            unsafe { msg_send![&*info, objectForKey: &*key] };
        underlying.is_some_and(|underlying| cancelled(&underlying))
    }

    fn start(sender: tokio::sync::oneshot::Sender<Result<(), RpcError>>) -> Result<(), RpcError> {
        let kind = pdf_type().ok_or_else(|| RpcError::new("UNSUPPORTED", "no PDF content type"))?;
        let app =
            own_app().ok_or_else(|| RpcError::new("UNSUPPORTED", "vivePDF is not installed"))?;
        let sender = std::sync::Mutex::new(Some(sender));
        let completion = RcBlock::new(move |error: *mut AnyObject| {
            let result = if error.is_null() {
                Ok(())
            } else {
                // SAFETY: the completion handler receives a valid NSError when the pointer is not null.
                let error = unsafe { &*error };
                // SAFETY: -[NSError localizedDescription] takes no arguments and returns an NSString.
                let message: Retained<NSString> = unsafe { msg_send![error, localizedDescription] };
                Err(if cancelled(error) {
                    RpcError::new("CANCELLED", message.to_string())
                } else {
                    RpcError::new("INTERNAL", message.to_string())
                })
            };
            if let Some(sender) = sender.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = sender.send(result);
            }
        });
        // SAFETY: the arguments are an NSURL, a UTType and a block taking an NSError pointer, as the selector expects.
        unsafe {
            let _: () = msg_send![
                &*workspace(),
                setDefaultApplicationAtURL: &*app,
                toOpenContentType: &*kind,
                completionHandler: &*completion
            ];
        }
        Ok(())
    }

    pub async fn make_default(
        _name: &str,
        _description: &str,
    ) -> Result<DefaultAppOutcome, RpcError> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        start(sender)?;
        receiver
            .await
            .map_err(|_| RpcError::new("INTERNAL", "no answer from the system"))??;
        Ok(DefaultAppOutcome::Done)
    }
}

#[cfg(windows)]
mod platform {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::UI::Shell::{
        AssocQueryStringW, ASSOCF_NONE, ASSOCSTR, ASSOCSTR_EXECUTABLE, ASSOCSTR_FRIENDLYAPPNAME,
    };

    use super::{same_executable, settings_uri, DefaultAppOutcome, DefaultAppStatus};
    use crate::file_association::registry;
    use crate::rpc::RpcError;

    fn query(kind: ASSOCSTR) -> Option<String> {
        let extension: Vec<u16> = ".pdf\0".encode_utf16().collect();
        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        // SAFETY: the extension is NUL-terminated and the buffer holds `length` UTF-16 units.
        let result = unsafe {
            AssocQueryStringW(
                ASSOCF_NONE,
                kind,
                PCWSTR(extension.as_ptr()),
                PCWSTR::null(),
                Some(PWSTR(buffer.as_mut_ptr())),
                &mut length,
            )
        };
        if result.is_err() {
            return None;
        }
        let end = buffer
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(buffer.len());
        let value = String::from_utf16_lossy(&buffer[..end]);
        (!value.trim().is_empty()).then_some(value)
    }

    pub fn status() -> DefaultAppStatus {
        let own = std::env::current_exe()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default();
        DefaultAppStatus {
            supported: true,
            is_default: query(ASSOCSTR_EXECUTABLE).is_some_and(|path| same_executable(&path, &own)),
            current: query(ASSOCSTR_FRIENDLYAPPNAME),
        }
    }

    pub async fn make_default(
        name: &str,
        description: &str,
    ) -> Result<DefaultAppOutcome, RpcError> {
        if !registry::enabled() || registry::stale() {
            registry::apply(name, description).map_err(|error| {
                let code = match error.kind() {
                    std::io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
                    _ => "INTERNAL",
                };
                RpcError::new(code, error.to_string())
            })?;
        }
        std::process::Command::new("explorer.exe")
            .arg(settings_uri(name))
            .spawn()
            .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
        Ok(DefaultAppOutcome::Settings)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use std::path::PathBuf;
    use std::process::Command;

    use super::{entry_display_name, find_own_entry, DefaultAppOutcome, DefaultAppStatus};
    use crate::rpc::RpcError;

    const PDF_MIME: &str = "application/pdf";

    fn application_dirs() -> Vec<PathBuf> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let data_home = std::env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| home.map(|home| home.join(".local/share")));
        let data_dirs = std::env::var("XDG_DATA_DIRS")
            .ok()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
        data_home
            .into_iter()
            .chain(
                data_dirs
                    .split(':')
                    .filter(|dir| !dir.is_empty())
                    .map(PathBuf::from),
            )
            .map(|dir| dir.join("applications"))
            .collect()
    }

    fn entries() -> Vec<(String, String)> {
        let mut found = Vec::new();
        for dir in application_dirs() {
            let Ok(listing) = std::fs::read_dir(&dir) else {
                continue;
            };
            for item in listing.flatten() {
                let id = item.file_name().to_string_lossy().to_string();
                if !id.ends_with(".desktop") || found.iter().any(|(known, _)| known == &id) {
                    continue;
                }
                if let Ok(contents) = std::fs::read_to_string(item.path()) {
                    found.push((id, contents));
                }
            }
        }
        found
    }

    fn own_entry(entries: &[(String, String)]) -> Option<String> {
        let executable = std::env::current_exe().ok()?;
        let name = executable.file_name()?.to_string_lossy().to_string();
        find_own_entry(entries, &name)
    }

    fn current_default() -> Option<String> {
        let output = Command::new("xdg-mime")
            .args(["query", "default", PDF_MIME])
            .output()
            .ok()?;
        let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (output.status.success() && !id.is_empty()).then_some(id)
    }

    pub fn status() -> DefaultAppStatus {
        let entries = entries();
        let Some(own) = own_entry(&entries) else {
            return DefaultAppStatus::unsupported();
        };
        let current = current_default();
        DefaultAppStatus {
            supported: true,
            is_default: current.as_deref() == Some(own.as_str()),
            current: current.map(|id| entry_display_name(&entries, &id)),
        }
    }

    pub async fn make_default(
        _name: &str,
        _description: &str,
    ) -> Result<DefaultAppOutcome, RpcError> {
        let own = own_entry(&entries())
            .ok_or_else(|| RpcError::new("UNSUPPORTED", "no desktop entry for vivePDF"))?;
        let output = Command::new("xdg-mime")
            .args(["default", own.as_str(), PDF_MIME])
            .output()
            .map_err(|error| RpcError::new("UNSUPPORTED", error.to_string()))?;
        if !output.status.success() {
            return Err(RpcError::new(
                "INTERNAL",
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }
        Ok(DefaultAppOutcome::Done)
    }
}

fn is_display_text(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 64 && !value.chars().any(|c| c.is_control())
}

#[tauri::command]
pub fn default_pdf_app_status() -> DefaultAppStatus {
    if crate::e2e::active() {
        return DefaultAppStatus::unsupported();
    }
    platform::status()
}

#[tauri::command]
pub async fn make_default_pdf_app(
    name: String,
    description: String,
) -> Result<DefaultAppOutcome, RpcError> {
    if !is_display_text(&name) || !is_display_text(&description) {
        return Err(RpcError::new("INVALID_PARAMS", "invalid application name"));
    }
    if crate::e2e::active() {
        return Err(RpcError::new("UNSUPPORTED", "not available in test runs"));
    }
    platform::make_default(&name, &description).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, contents: &str) -> (String, String) {
        (id.to_string(), contents.to_string())
    }

    #[test]
    fn app_names_lose_the_bundle_extension() {
        assert_eq!(app_display_name("Preview.app"), "Preview");
        assert_eq!(app_display_name("Önizleme"), "Önizleme");
    }

    #[test]
    fn settings_uri_names_the_registered_application() {
        assert_eq!(
            settings_uri("vivePDF"),
            "ms-settings:defaultapps?registeredAppUser=vivePDF"
        );
        assert_eq!(
            settings_uri("vive PDF&x"),
            "ms-settings:defaultapps?registeredAppUser=vive%20PDF%26x"
        );
    }

    #[test]
    fn executables_compare_without_case_quotes_or_slash_style() {
        assert!(same_executable(
            "\"C:\\Program Files\\vivePDF\\vivepdf.exe\"",
            "c:/program files/vivepdf/VIVEPDF.EXE"
        ));
        assert!(!same_executable(
            "C:\\Edge\\msedge.exe",
            "C:\\vivePDF\\vivepdf.exe"
        ));
        assert!(!same_executable("", ""));
    }

    #[test]
    fn desktop_entries_are_matched_by_their_program() {
        let entries = vec![
            entry("org.gnome.Evince.desktop", "[Desktop Entry]\nName=Document Viewer\nExec=evince %U\n"),
            entry(
                "vivePDF.desktop",
                "[Desktop Entry]\nName=vivePDF\nExec=\"/usr/bin/vivepdf\" %F\n[Desktop Action New]\nExec=other\n",
            ),
        ];

        assert_eq!(
            find_own_entry(&entries, "vivepdf").as_deref(),
            Some("vivePDF.desktop")
        );
        assert_eq!(find_own_entry(&entries, "okular"), None);
        assert_eq!(
            entry_display_name(&entries, "org.gnome.Evince.desktop"),
            "Document Viewer"
        );
        assert_eq!(entry_display_name(&entries, "okular.desktop"), "okular");
    }

    #[test]
    fn desktop_values_come_from_the_main_group_only() {
        let contents = "[Desktop Action Open]\nName=Open\n[Desktop Entry]\nName[de]=Betrachter\nName=Viewer\nExec=/opt/app/viewer --flag %f\n";

        assert_eq!(desktop_value(contents, "Name"), Some("Viewer"));
        assert_eq!(exec_program(contents).as_deref(), Some("viewer"));
        assert_eq!(exec_program("[Desktop Entry]\nName=x\n"), None);
    }
}

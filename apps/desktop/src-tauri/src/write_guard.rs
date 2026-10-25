use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use serde_json::{json, Value};

use crate::rpc::RpcError;

const BLOCKED_EXTENSIONS: [&str; 36] = [
    "exe", "com", "bat", "cmd", "scr", "pif", "cpl", "msi", "msp", "msc", "dll", "sys", "ps1",
    "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "lnk", "url", "scf", "reg",
    "inf", "jar", "sh", "bash", "zsh", "command", "desktop", "app", "appimage", "service",
];

const BLOCKED_NAMES: [&str; 11] = [
    ".bashrc",
    ".bash_profile",
    ".bash_login",
    ".profile",
    ".zshrc",
    ".zprofile",
    ".zshenv",
    ".zlogin",
    ".login",
    ".cshrc",
    ".tcshrc",
];

const FILE_KEYS: [&str; 2] = ["output", "textOutput"];
const DIRECTORY_KEYS: [&str; 1] = ["outputDir"];
const FILE_LIST_KEYS: [&str; 1] = ["outputs"];

fn blocked(path: &Path) -> RpcError {
    RpcError {
        code: "PERMISSION_DENIED".to_string(),
        message: format!("vivePDF does not write to {}", path.display()),
        data: Some(json!({ "reason": "blockedTarget" })),
    }
}

static APP_DIRS: OnceLock<Vec<PathBuf>> = OnceLock::new();

pub fn protect_app_dirs(dirs: Vec<PathBuf>) {
    let _ = APP_DIRS.set(dirs);
}

pub fn comparable(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if cfg!(any(windows, target_os = "macos")) {
        text.to_lowercase()
    } else {
        text
    }
}

fn lexical(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                result.pop();
            }
            Component::CurDir => {}
            other => result.push(other),
        }
    }
    result
}

fn followed(absolute: &Path) -> PathBuf {
    let mut real = PathBuf::new();
    let mut missing = false;
    for component in absolute.components() {
        match component {
            Component::ParentDir => {
                real.pop();
            }
            Component::CurDir => {}
            Component::Normal(name) => {
                real.push(name);
                if !missing {
                    match std::fs::canonicalize(&real) {
                        Ok(canonical) => real = canonical,
                        Err(_) => missing = true,
                    }
                }
            }
            other => real.push(other),
        }
    }
    real
}

pub fn resolved(path: &Path) -> PathBuf {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    if !cfg!(windows) {
        return followed(&absolute);
    }
    let normal = lexical(&absolute);
    let mut existing = normal.as_path();
    let mut rest = Vec::new();
    loop {
        if let Ok(real) = std::fs::canonicalize(existing) {
            return rest.iter().rev().fold(real, |acc, part| acc.join(part));
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                existing = parent;
            }
            _ => return normal,
        }
    }
}

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub(crate) fn protected_dirs() -> Vec<PathBuf> {
    let mut dirs = autostart_dirs();
    if let Some(app_dirs) = APP_DIRS.get() {
        dirs.extend(app_dirs.iter().cloned());
    }
    dirs
}

fn autostart_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        let startup = Path::new("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs");
        if let Some(roaming) = env_dir("APPDATA") {
            dirs.push(roaming.join(&startup).join("Startup"));
        }
        if let Some(shared) = env_dir("PROGRAMDATA") {
            dirs.push(shared.join(&startup).join("StartUp"));
        }
    }
    if cfg!(target_os = "macos") {
        dirs.push(PathBuf::from("/Library/LaunchAgents"));
        dirs.push(PathBuf::from("/Library/LaunchDaemons"));
        if let Some(home) = env_dir("HOME") {
            dirs.push(home.join("Library").join("LaunchAgents"));
        }
    }
    if cfg!(all(unix, not(target_os = "macos"))) {
        dirs.push(PathBuf::from("/etc/xdg/autostart"));
        let config =
            env_dir("XDG_CONFIG_HOME").or_else(|| env_dir("HOME").map(|home| home.join(".config")));
        if let Some(config) = config {
            dirs.push(config.join("autostart"));
            dirs.push(config.join("systemd").join("user"));
        }
    }
    dirs
}

fn inside_protected_dir(target: &Path, protected: &[PathBuf]) -> bool {
    let target = comparable(target);
    if target.split('/').any(|part| part == ".ssh") {
        return true;
    }
    protected.iter().any(|dir| {
        let dir = comparable(&resolved(dir));
        let dir = dir.trim_end_matches('/');
        target == dir || target.starts_with(&format!("{dir}/"))
    })
}

fn blocked_file_name(name: &str) -> bool {
    if cfg!(windows) && name.contains(':') {
        return true;
    }
    let visible = name.trim_end_matches(['.', ' ']).to_lowercase();
    if BLOCKED_NAMES.contains(&visible.as_str()) {
        return true;
    }
    Path::new(&visible)
        .extension()
        .map(|extension| BLOCKED_EXTENSIONS.contains(&extension.to_string_lossy().as_ref()))
        .unwrap_or(false)
}

fn check_with(path: &Path, protected: &[PathBuf], directory: bool) -> Result<(), RpcError> {
    let target = resolved(path);
    if inside_protected_dir(&target, protected) {
        return Err(blocked(path));
    }
    if directory {
        return Ok(());
    }
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    if blocked_file_name(&name) {
        return Err(blocked(path));
    }
    Ok(())
}

pub fn check_file(path: &Path) -> Result<(), RpcError> {
    check_with(path, &protected_dirs(), false)
}

pub fn check_folder(path: &Path) -> Result<(), RpcError> {
    check_with(path, &protected_dirs(), true)
}

fn check_value(value: &Value, protected: &[PathBuf]) -> Result<(), RpcError> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                match child {
                    Value::String(path) if FILE_KEYS.contains(&key.as_str()) => {
                        check_with(Path::new(path), protected, false)?
                    }
                    Value::String(path) if DIRECTORY_KEYS.contains(&key.as_str()) => {
                        check_with(Path::new(path), protected, true)?
                    }
                    Value::Array(items) if FILE_LIST_KEYS.contains(&key.as_str()) => {
                        for item in items {
                            match item {
                                Value::String(path) => {
                                    check_with(Path::new(path), protected, false)?
                                }
                                other => check_value(other, protected)?,
                            }
                        }
                    }
                    other => check_value(other, protected)?,
                }
            }
            Ok(())
        }
        Value::Array(items) => items
            .iter()
            .try_for_each(|item| check_value(item, protected)),
        _ => Ok(()),
    }
}

pub fn check_params(params: &Value) -> Result<(), RpcError> {
    check_value(params, &protected_dirs())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("vivepdf-guard-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn documents_and_pictures_may_be_written() {
        let dir = scratch("allowed");
        for name in [
            "report.pdf",
            "notes.txt",
            "scan.png",
            "slides.pptx",
            "page.html",
            "no-extension",
        ] {
            assert!(check_with(&dir.join(name), &[], false).is_ok(), "{name}");
        }
    }

    #[test]
    fn programs_scripts_and_shortcuts_are_refused_even_when_disguised() {
        let dir = scratch("programs");
        for name in [
            "run.exe",
            "RUN.EXE",
            "start.bat",
            "go.ps1",
            "link.lnk",
            "open.desktop",
            "tool.sh",
            "evil.exe.",
            "evil.exe  ",
            ".bashrc",
            ".Profile",
        ] {
            let error = check_with(&dir.join(name), &[], false).unwrap_err();
            assert_eq!(error.code, "PERMISSION_DENIED", "{name}");
            assert_eq!(error.data, Some(json!({ "reason": "blockedTarget" })));
        }
    }

    #[cfg(windows)]
    #[test]
    fn alternate_data_streams_are_refused() {
        let dir = scratch("streams");
        assert!(check_with(&dir.join("report.pdf:hidden.exe"), &[], false).is_err());
        assert!(check_with(&dir.join("report.pdf::$DATA"), &[], false).is_err());
    }

    #[test]
    fn autostart_and_ssh_folders_are_refused_through_dot_dot_and_any_case() {
        let dir = scratch("autostart");
        let startup = dir.join("Startup");
        std::fs::create_dir_all(&startup).unwrap();
        let protected = vec![startup.clone()];

        assert!(check_with(&startup.join("note.txt"), &protected, false).is_err());
        assert!(check_with(
            &dir.join("other").join("..").join("Startup").join("a.pdf"),
            &protected,
            false
        )
        .is_err());
        assert!(check_with(&startup.join("new").join("deep.pdf"), &protected, true).is_err());
        assert!(check_with(&dir.join(".ssh").join("authorized_keys"), &protected, false).is_err());
        assert!(check_with(&dir.join("StartupNotes").join("a.pdf"), &protected, false).is_ok());
        if cfg!(any(windows, target_os = "macos")) {
            assert!(check_with(&dir.join("STARTUP").join("a.pdf"), &protected, false).is_err());
        }
    }

    #[test]
    fn op_params_are_checked_for_every_output_at_any_depth() {
        let dir = scratch("params");
        let startup = dir.join("Startup");
        std::fs::create_dir_all(&startup).unwrap();
        let protected = vec![startup.clone()];
        let fine = json!({ "path": dir.join("in.exe"), "output": dir.join("out.pdf"), "steps": [{ "outputDir": dir.join("pages") }] });
        let program = json!({ "steps": [{ "params": { "output": dir.join("out.exe") } }] });
        let text = json!({ "textOutput": dir.join("words.cmd") });
        let folder = json!({ "outputDir": startup });
        let listed = json!({ "outputs": [dir.join("a.pdf"), dir.join("b.vbs")] });

        assert!(check_value(&fine, &protected).is_ok());
        for params in [program, text, folder, listed] {
            assert!(check_value(&params, &protected).is_err(), "{params}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_parent_step_after_a_linked_folder_leaves_from_where_the_link_points() {
        let dir = scratch("linked-parent");
        let granted = dir.join("granted");
        let elsewhere = dir.join("elsewhere").join("inner");
        std::fs::create_dir_all(&granted).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, granted.join("link")).unwrap();

        let target = resolved(&granted.join("link").join("..").join("evil.plist"));

        assert_eq!(
            target,
            std::fs::canonicalize(dir.join("elsewhere"))
                .unwrap()
                .join("evil.plist")
        );
        assert!(!target.starts_with(std::fs::canonicalize(&granted).unwrap()));
    }

    #[test]
    fn a_missing_folder_is_resolved_from_its_nearest_existing_parent() {
        let dir = scratch("resolve");
        let target = resolved(&dir.join("a").join("..").join("b").join("c.pdf"));
        assert_eq!(
            target,
            std::fs::canonicalize(&dir).unwrap().join("b").join("c.pdf")
        );
    }
}

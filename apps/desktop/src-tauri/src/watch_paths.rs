use std::path::{Component, Path, PathBuf};

use serde::Serialize;

pub(crate) type Snapshot = (u64, Option<std::time::SystemTime>);

fn comparable(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let plain = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text.to_string()
    };
    if cfg!(windows) {
        PathBuf::from(plain.to_lowercase())
    } else {
        PathBuf::from(plain)
    }
}

pub fn canonical_form(path: &Path) -> PathBuf {
    let components: Vec<Component> = path.components().collect();
    for split in (1..=components.len()).rev() {
        let prefix: PathBuf = components[..split].iter().collect();
        let Ok(mut resolved) = std::fs::canonicalize(&prefix) else {
            continue;
        };
        for component in &components[split..] {
            match component {
                Component::ParentDir => {
                    resolved.pop();
                }
                Component::CurDir => {}
                other => resolved.push(other.as_os_str()),
            }
        }
        return comparable(&resolved);
    }
    comparable(path)
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PathRelation {
    pub same: bool,
    pub inside: bool,
}

pub fn path_relation(path: &Path, base: &Path) -> PathRelation {
    let path = canonical_form(path);
    let base = canonical_form(base);
    PathRelation {
        same: path == base,
        inside: path != base && path.starts_with(&base),
    }
}

pub(crate) fn is_excluded(path: &Path, exclude: Option<&Path>) -> bool {
    exclude.is_some_and(|excluded| canonical_form(path).starts_with(excluded))
}

pub(crate) fn is_protected_root(path: &Path) -> bool {
    let path = comparable(path);
    if path.parent().is_none() {
        return true;
    }
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let windir_path = PathBuf::from(&windir);
    let system_roots = [
        windir_path.as_path(),
        Path::new("C:\\Program Files"),
        Path::new("C:\\Program Files (x86)"),
        Path::new("C:\\ProgramData"),
        Path::new("/System"),
        Path::new("/Library"),
        Path::new("/usr"),
        Path::new("/etc"),
        Path::new("/bin"),
        Path::new("/sbin"),
        Path::new("/Applications"),
        Path::new("/private/etc"),
    ];
    system_roots.iter().any(|root| {
        let root = comparable(root);
        path == root || path.starts_with(&root)
    })
}

pub fn is_watchable_pdf(path: &Path) -> bool {
    let is_pdf = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return false;
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    !name.contains(".tmp-vivepdf")
}

pub(crate) fn snapshot(path: &Path) -> Option<Snapshot> {
    std::fs::metadata(path)
        .ok()
        .map(|meta| (meta.len(), meta.modified().ok()))
}

pub(crate) fn is_readable(path: &Path) -> bool {
    std::fs::File::open(path).is_ok()
}

pub(crate) fn unchanged(before: Option<Snapshot>, after: Option<Snapshot>) -> bool {
    before.is_some() && before == after
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pdf_extension_case_insensitive() {
        assert!(is_watchable_pdf(Path::new("C:/docs/report.PDF")));
    }

    #[test]
    fn rejects_non_pdf_extension() {
        assert!(!is_watchable_pdf(Path::new("C:/docs/report.txt")));
    }

    #[test]
    fn rejects_temp_write_marker() {
        assert!(!is_watchable_pdf(Path::new(
            "C:/docs/report.tmp-vivepdf.pdf"
        )));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_filesystem_root() {
        assert!(is_protected_root(Path::new("C:\\")));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_program_files() {
        assert!(is_protected_root(Path::new("C:\\Program Files\\vivePDF")));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_a_system_folder_behind_the_verbatim_prefix() {
        assert!(is_protected_root(Path::new(
            r"\\?\C:\Program Files\vivePDF"
        )));
        assert!(is_protected_root(Path::new(r"\\?\C:\")));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_a_system_folder_written_in_another_case() {
        assert!(is_protected_root(Path::new(r"c:\program files\vivePDF")));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_the_canonical_form_of_the_windows_folder() {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".to_string());
        let canonical = std::fs::canonicalize(&windir).unwrap_or_else(|_| PathBuf::from(&windir));
        assert!(is_protected_root(&canonical));
    }

    #[cfg(windows)]
    #[test]
    fn accepts_a_user_folder_behind_the_verbatim_prefix() {
        assert!(!is_protected_root(Path::new(
            r"\\?\C:\Users\me\Documents\pdfs"
        )));
    }

    #[test]
    fn a_missing_file_is_never_stable() {
        let missing = snapshot(Path::new("vivepdf-no-such-file.pdf"));
        assert!(!unchanged(missing, missing));
    }

    #[test]
    fn a_finished_file_is_stable() {
        let path = std::env::temp_dir().join("vivepdf-watch-stable-test.pdf");
        std::fs::write(&path, b"%PDF-1.7").unwrap();
        assert!(unchanged(snapshot(&path), snapshot(&path)));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_file_that_grew_since_it_was_last_seen_is_not_stable() {
        let path = std::env::temp_dir().join("vivepdf-watch-growing-test.pdf");
        std::fs::write(&path, b"%PDF-1.7").unwrap();
        let before = snapshot(&path);
        std::fs::write(&path, b"%PDF-1.7 1 0 obj").unwrap();
        assert!(!unchanged(before, snapshot(&path)));
        let _ = std::fs::remove_file(&path);
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vivepdf-watch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("in").join("nested")).unwrap();
        std::fs::create_dir_all(dir.join("out")).unwrap();
        dir
    }

    #[test]
    fn dot_dot_segments_resolve_to_the_same_folder() {
        let dir = scratch_dir("dots");
        let watched = dir.join("in");
        let aliased = dir.join("in").join("nested").join("..");
        assert_eq!(
            path_relation(&aliased, &watched),
            PathRelation {
                same: true,
                inside: false
            }
        );
        assert!(!path_relation(&dir.join("out"), &watched).same);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_that_does_not_exist_yet_is_compared_through_its_parent() {
        let dir = scratch_dir("missing");
        let watched = dir.join("in");
        let planned = dir.join("out").join("..").join("in").join("later");
        assert_eq!(
            path_relation(&planned, &watched),
            PathRelation {
                same: false,
                inside: true
            }
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn case_and_separators_do_not_hide_the_same_folder() {
        let dir = scratch_dir("case");
        let watched = dir.join("in");
        let shouted = PathBuf::from(watched.to_string_lossy().to_uppercase().replace('\\', "/"));
        assert!(path_relation(&shouted, &watched).same);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_to_the_watched_folder_is_the_same_folder() {
        let dir = scratch_dir("junction");
        let watched = dir.join("in");
        let link = dir.join("link");
        let created = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&watched)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);
        assert!(created, "could not create a junction");
        assert!(path_relation(&link, &watched).same);
        assert!(path_relation(&link.join("nested"), &watched).inside);
        assert!(is_excluded(
            &watched.join("nested").join("a.pdf"),
            Some(&canonical_form(&link))
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn events_inside_the_excluded_folder_are_dropped() {
        let dir = scratch_dir("exclude");
        let out = canonical_form(&dir.join("out"));
        assert!(is_excluded(&dir.join("out").join("done.pdf"), Some(&out)));
        assert!(!is_excluded(&dir.join("in").join("new.pdf"), Some(&out)));
        assert!(!is_excluded(&dir.join("out").join("done.pdf"), None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_unix_system_folders() {
        assert!(is_protected_root(Path::new("/")));
        assert!(is_protected_root(Path::new("/System/Library")));
        assert!(is_protected_root(Path::new("/usr/local/bin")));
        assert!(is_protected_root(Path::new("/Applications/vivePDF.app")));
    }

    #[cfg(unix)]
    #[test]
    fn accepts_unix_home_folders() {
        assert!(!is_protected_root(Path::new("/Users/me/Documents/pdfs")));
        assert!(!is_protected_root(Path::new("/home/me/pdfs")));
        assert!(!is_protected_root(&std::env::temp_dir()));
    }

    #[test]
    fn accepts_user_documents_folder() {
        assert!(!is_protected_root(Path::new(
            "C:\\Users\\me\\Documents\\pdfs"
        )));
    }
}

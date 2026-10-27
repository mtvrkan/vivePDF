use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::rpc::RpcError;

const VERSIONS_DIR: &str = "document-versions";
const MAX_VERSIONS: usize = 100;
const MAX_VERSION_BYTES: usize = 128 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
const HOUR_MS: u64 = 60 * 60 * 1000;
const DAY_MS: u64 = 24 * HOUR_MS;
const WEEK_MS: u64 = 7 * DAY_MS;
const STALE_STAGING: Duration = Duration::from_secs(10 * 60);
const KINDS: [&str; 4] = ["open", "save", "auto", "restore"];
const HASH_CHARS: usize = 16;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    id: String,
    kind: String,
    saved_at: u64,
    bytes: u64,
}

struct Stored {
    info: VersionInfo,
    hash: String,
    file: PathBuf,
}

fn internal(error: impl ToString) -> RpcError {
    RpcError::new("INTERNAL", error.to_string())
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn document_dir(root: &Path, path: &str) -> PathBuf {
    let digest = Sha256::digest(crate::document_windows::claim_key(path).as_bytes());
    root.join(VERSIONS_DIR).join(hex(&digest))
}

fn parse_id(id: &str) -> Option<(u64, &str, &str)> {
    let mut parts = id.splitn(3, '-');
    let (time, kind, hash) = (parts.next()?, parts.next()?, parts.next()?);
    let valid = !time.is_empty()
        && time.len() <= 16
        && time.bytes().all(|byte| byte.is_ascii_digit())
        && KINDS.contains(&kind)
        && hash.len() == HASH_CHARS
        && hash
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
    if !valid {
        return None;
    }
    Some((time.parse().ok()?, kind, hash))
}

fn stored(dir: &Path) -> std::io::Result<Vec<Stored>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut versions: Vec<Stored> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let id = name.strip_suffix(".json")?;
            let (saved_at, kind, hash) = parse_id(id)?;
            let metadata = entry.metadata().ok().filter(std::fs::Metadata::is_file)?;
            Some(Stored {
                info: VersionInfo {
                    id: id.to_string(),
                    kind: kind.to_string(),
                    saved_at,
                    bytes: metadata.len(),
                },
                hash: hash.to_string(),
                file: entry.path(),
            })
        })
        .collect();
    versions.sort_by(|a, b| {
        b.info
            .saved_at
            .cmp(&a.info.saved_at)
            .then_with(|| b.info.id.cmp(&a.info.id))
    });
    Ok(versions)
}

fn list_versions(dir: &Path) -> Result<Vec<VersionInfo>, RpcError> {
    Ok(stored(dir)
        .map_err(internal)?
        .into_iter()
        .map(|version| version.info)
        .collect())
}

fn read_version(dir: &Path, id: &str) -> Result<Option<String>, RpcError> {
    if parse_id(id).is_none() {
        return Err(RpcError::new("INVALID_PARAMS", "unknown version"));
    }
    match std::fs::read_to_string(dir.join(format!("{id}.json"))) {
        Ok(text) if text.len() <= MAX_VERSION_BYTES => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(internal(error)),
    }
}

fn thinning_bucket(saved_at: u64, now: u64) -> Option<(u8, u64)> {
    let age = now.saturating_sub(saved_at);
    if age < HOUR_MS {
        None
    } else if age < DAY_MS {
        Some((1, saved_at / HOUR_MS))
    } else if age < 30 * DAY_MS {
        Some((2, saved_at / DAY_MS))
    } else {
        Some((3, saved_at / WEEK_MS))
    }
}

fn prune(versions: &[Stored], now: u64) {
    let mut buckets = HashSet::new();
    let mut kept = 0usize;
    let mut total = 0u64;
    for (index, version) in versions.iter().enumerate() {
        let thinned = index > 0
            && version.info.kind != "restore"
            && thinning_bucket(version.info.saved_at, now)
                .is_some_and(|bucket| !buckets.insert(bucket));
        let over =
            index > 0 && (kept >= MAX_VERSIONS || total + version.info.bytes > MAX_DOCUMENT_BYTES);
        if thinned || over {
            let _ = std::fs::remove_file(&version.file);
            continue;
        }
        kept += 1;
        total += version.info.bytes;
    }
}

fn sweep_staging(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= STALE_STAGING);
        if stale && entry.file_name().to_string_lossy().ends_with(".tmp") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn write_atomically(file: &Path, contents: &[u8]) -> std::io::Result<()> {
    let staging = file.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
    let written = std::fs::File::create(&staging).and_then(|mut handle| {
        handle.write_all(contents)?;
        handle.sync_all()
    });
    let moved = written.and_then(|()| std::fs::rename(&staging, file));
    if moved.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    moved
}

fn write_version(
    dir: &Path,
    kind: &str,
    contents: &str,
    now: u64,
) -> Result<VersionInfo, RpcError> {
    if !KINDS.contains(&kind) {
        return Err(RpcError::new("INVALID_PARAMS", "unknown version kind"));
    }
    if contents.len() > MAX_VERSION_BYTES {
        return Err(RpcError::new("INVALID_PARAMS", "version too large"));
    }
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| RpcError::new("INVALID_PARAMS", error.to_string()))?;
    let hash = hex(&Sha256::digest(contents.as_bytes()))[..HASH_CHARS].to_string();
    let existing = stored(dir).map_err(internal)?;
    if let Some(newest) = existing.first().filter(|newest| newest.hash == hash) {
        return Ok(newest.info.clone());
    }
    std::fs::create_dir_all(dir).map_err(internal)?;
    sweep_staging(dir);
    let newest = existing.first().map_or(0, |version| version.info.saved_at);
    let saved_at = now.max(newest + 1);
    let id = format!("{saved_at:013}-{kind}-{hash}");
    let file = dir.join(format!("{id}.json"));
    write_atomically(&file, contents.as_bytes()).map_err(internal)?;
    let info = VersionInfo {
        id,
        kind: kind.to_string(),
        saved_at,
        bytes: contents.len() as u64,
    };
    let mut versions = vec![Stored {
        info: info.clone(),
        hash,
        file,
    }];
    versions.extend(existing);
    prune(&versions, now);
    Ok(info)
}

fn carry_versions(from: &Path, to: &Path, now: u64) -> Result<usize, RpcError> {
    if from == to {
        return Ok(0);
    }
    let source = stored(from).map_err(internal)?;
    if source.is_empty() {
        return Ok(0);
    }
    std::fs::create_dir_all(to).map_err(internal)?;
    let mut copied = 0;
    for version in &source {
        let target = to.join(format!("{}.json", version.info.id));
        if target.exists() {
            continue;
        }
        let contents = std::fs::read(&version.file).map_err(internal)?;
        write_atomically(&target, &contents).map_err(internal)?;
        copied += 1;
    }
    prune(&stored(to).map_err(internal)?, now);
    Ok(copied)
}

fn versions_root(app: &tauri::AppHandle, paths: &[&str]) -> Result<PathBuf, RpcError> {
    if paths.iter().any(|path| path.trim().is_empty()) {
        return Err(RpcError::new("INVALID_PARAMS", "document path required"));
    }
    app.path().app_data_dir().map_err(internal)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RpcError> + Send + 'static,
) -> Result<T, RpcError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(internal)?
}

#[tauri::command]
pub async fn document_versions_list(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<VersionInfo>, RpcError> {
    let root = versions_root(&app, &[&path])?;
    blocking(move || list_versions(&document_dir(&root, &path))).await
}

#[tauri::command]
pub async fn document_versions_read(
    app: tauri::AppHandle,
    path: String,
    id: String,
) -> Result<Option<String>, RpcError> {
    let root = versions_root(&app, &[&path])?;
    blocking(move || read_version(&document_dir(&root, &path), &id)).await
}

#[tauri::command]
pub async fn document_versions_write(
    app: tauri::AppHandle,
    path: String,
    kind: String,
    contents: String,
) -> Result<VersionInfo, RpcError> {
    let root = versions_root(&app, &[&path])?;
    blocking(move || write_version(&document_dir(&root, &path), &kind, &contents, now_millis()))
        .await
}

#[tauri::command]
pub async fn document_versions_carry(
    app: tauri::AppHandle,
    from: String,
    to: String,
) -> Result<usize, RpcError> {
    let root = versions_root(&app, &[&from, &to])?;
    blocking(move || {
        carry_versions(
            &document_dir(&root, &from),
            &document_dir(&root, &to),
            now_millis(),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("vivepdf-versions-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn snapshot(text: &str) -> String {
        format!(r#"{{"version":6,"kind":"document","name":"{text}"}}"#)
    }

    #[test]
    fn versions_are_listed_newest_first_and_read_back() {
        let dir = document_dir(&scratch("roundtrip"), "/Users/ş/tez.vpdoc");
        let first = write_version(&dir, "save", &snapshot("a"), 1_000).unwrap();
        let second = write_version(&dir, "auto", &snapshot("b"), 2_000).unwrap();

        let listed = list_versions(&dir).unwrap();

        assert_eq!(listed, vec![second.clone(), first.clone()]);
        assert_eq!(read_version(&dir, &first.id).unwrap(), Some(snapshot("a")));
        assert_eq!(second.kind, "auto");
    }

    #[test]
    fn an_unchanged_snapshot_is_not_stored_twice() {
        let dir = document_dir(&scratch("dedupe"), "/tmp/a.vpdoc");
        let first = write_version(&dir, "open", &snapshot("same"), 1_000).unwrap();

        let again = write_version(&dir, "save", &snapshot("same"), 5_000).unwrap();

        assert_eq!(again, first);
        assert_eq!(list_versions(&dir).unwrap().len(), 1);
    }

    #[test]
    fn only_the_newest_hundred_of_one_hour_are_kept() {
        let dir = document_dir(&scratch("prune"), "/tmp/b.vpdoc");
        for index in 0..105u64 {
            write_version(&dir, "auto", &snapshot(&index.to_string()), 1_000 + index).unwrap();
        }

        let listed = list_versions(&dir).unwrap();

        assert_eq!(listed.len(), MAX_VERSIONS);
        assert_eq!(listed[0].saved_at, 1_104);
        assert_eq!(listed[MAX_VERSIONS - 1].saved_at, 1_005);
    }

    #[test]
    fn older_versions_thin_out_to_one_per_hour_day_and_week() {
        let dir = document_dir(&scratch("thin"), "/tmp/thin.vpdoc");
        let now = 400 * DAY_MS;
        let minute = 60 * 1000;
        let ages = [
            200 * DAY_MS,
            200 * DAY_MS - minute,
            10 * DAY_MS,
            10 * DAY_MS - minute,
            5 * HOUR_MS,
            5 * HOUR_MS - minute,
            30 * minute,
            20 * minute,
        ];
        for (index, age) in ages.iter().enumerate() {
            write_version(&dir, "save", &snapshot(&index.to_string()), now - age).unwrap();
        }
        let kept: Vec<u64> = list_versions(&dir)
            .unwrap()
            .iter()
            .map(|version| now - version.saved_at)
            .collect();

        assert_eq!(
            kept,
            vec![
                20 * minute,
                30 * minute,
                5 * HOUR_MS - minute,
                10 * DAY_MS - minute,
                200 * DAY_MS - minute
            ]
        );
    }

    #[test]
    fn versions_kept_before_a_restore_are_never_thinned() {
        let dir = document_dir(&scratch("restore"), "/tmp/r.vpdoc");
        let now = 50 * DAY_MS;
        write_version(&dir, "restore", &snapshot("before"), now - 3 * DAY_MS).unwrap();
        write_version(&dir, "save", &snapshot("later"), now - 3 * DAY_MS + 1_000).unwrap();
        write_version(&dir, "save", &snapshot("now"), now).unwrap();

        let kinds: Vec<String> = list_versions(&dir)
            .unwrap()
            .into_iter()
            .map(|version| version.kind)
            .collect();

        assert_eq!(kinds, vec!["save", "save", "restore"]);
    }

    #[test]
    fn save_as_carries_the_history_to_the_new_file() {
        let root = scratch("carry");
        let old = document_dir(&root, "/eski/tez.vpdoc");
        let new = document_dir(&root, "/yeni/tez-son.vpdoc");
        write_version(&old, "save", &snapshot("a"), 1_000).unwrap();
        write_version(&old, "auto", &snapshot("b"), 2_000).unwrap();
        write_version(&new, "save", &snapshot("c"), 3_000).unwrap();

        let copied = carry_versions(&old, &new, 3_000).unwrap();
        let again = carry_versions(&old, &new, 3_000).unwrap();

        assert_eq!((copied, again), (2, 0));
        assert_eq!(list_versions(&new).unwrap().len(), 3);
        assert_eq!(list_versions(&old).unwrap().len(), 2);
    }

    #[test]
    fn left_over_staging_files_are_swept_and_never_listed() {
        let dir = document_dir(&scratch("staging"), "/tmp/s.vpdoc");
        std::fs::create_dir_all(&dir).unwrap();
        let stale = dir.join("0000000001000-save-0123456789abcdef.abc.tmp");
        std::fs::write(&stale, "x").unwrap();
        let old = SystemTime::now() - STALE_STAGING - Duration::from_secs(5);
        std::fs::File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_modified(old)
            .unwrap();

        write_version(&dir, "save", &snapshot("a"), 2_000).unwrap();

        assert!(!stale.exists());
        assert_eq!(list_versions(&dir).unwrap().len(), 1);
        let leftovers = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn same_millisecond_snapshots_get_distinct_ids() {
        let dir = document_dir(&scratch("clock"), "/tmp/c.vpdoc");
        let first = write_version(&dir, "save", &snapshot("a"), 9_000).unwrap();

        let second = write_version(&dir, "save", &snapshot("b"), 9_000).unwrap();

        assert_ne!(first.id, second.id);
        assert_eq!(second.saved_at, 9_001);
    }

    #[test]
    fn documents_keep_separate_histories() {
        let root = scratch("separate");
        write_version(&document_dir(&root, "/a.vpdoc"), "save", &snapshot("a"), 1).unwrap();

        let other = list_versions(&document_dir(&root, "/b.vpdoc")).unwrap();

        assert!(other.is_empty());
    }

    #[test]
    fn bad_input_is_refused() {
        let dir = document_dir(&scratch("refuse"), "/tmp/d.vpdoc");

        let not_json = write_version(&dir, "save", "{nope", 1);
        let bad_kind = write_version(&dir, "../x", &snapshot("a"), 1);
        let traversal = read_version(&dir, "../../session");
        let missing = read_version(&dir, "0000000000001-save-0123456789abcdef").unwrap();

        assert_eq!(not_json.unwrap_err().code, "INVALID_PARAMS");
        assert_eq!(bad_kind.unwrap_err().code, "INVALID_PARAMS");
        assert_eq!(traversal.unwrap_err().code, "INVALID_PARAMS");
        assert_eq!(missing, None);
    }
}

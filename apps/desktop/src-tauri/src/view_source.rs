use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::http::{header, HeaderValue, Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, Url};

use crate::files::io_error;
use crate::navigation::is_app_url;
use crate::rpc::RpcError;

pub const SCHEME: &str = "vivepdf-view";
const SNAPSHOT_DIR_NAME: &str = "view-snapshots";
const LARGE_VIEW_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RANGE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SOURCES: usize = 64;
const BUDGET_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const FREE_SPACE_MARGIN: u64 = 2 * 1024 * 1024 * 1024;

struct Source {
    snapshot: PathBuf,
    length: u64,
    window: String,
}

#[derive(Default)]
struct Ledger {
    sources: HashMap<String, Source>,
    reserved_count: usize,
    reserved_bytes: u64,
}

impl Ledger {
    fn held_bytes(&self) -> u64 {
        self.sources
            .values()
            .map(|source| source.length)
            .sum::<u64>()
            + self.reserved_bytes
    }
}

#[derive(Default)]
pub struct ViewSources(Mutex<Ledger>);

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewSource {
    pub token: String,
    pub length: u64,
}

pub struct Admission {
    pub threshold: u64,
    pub budget_bytes: u64,
    pub free_space: Option<u64>,
}

fn sources_unavailable() -> RpcError {
    RpcError::new("INTERNAL", "view sources unavailable")
}

fn limit_reached(message: &str) -> RpcError {
    RpcError::new("INVALID_PARAMS", message)
}

fn remove_snapshot(path: &Path) {
    if let Err(error) = std::fs::remove_file(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!("[view] could not remove a view snapshot: {error}");
        }
    }
}

fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

impl ViewSources {
    fn ledger(&self) -> Result<MutexGuard<'_, Ledger>, RpcError> {
        self.0.lock().map_err(|_| sources_unavailable())
    }

    fn reserve(&self, length: u64, admission: &Admission) -> Result<(), RpcError> {
        let mut ledger = self.ledger()?;
        if ledger.sources.len() + ledger.reserved_count >= MAX_SOURCES {
            return Err(limit_reached("too many large documents open"));
        }
        if ledger.held_bytes() + length > admission.budget_bytes {
            return Err(limit_reached(
                "large documents already hold their disk budget",
            ));
        }
        if admission
            .free_space
            .is_some_and(|free| free < length.saturating_add(FREE_SPACE_MARGIN))
        {
            return Err(limit_reached("not enough free disk space for a view copy"));
        }
        ledger.reserved_count += 1;
        ledger.reserved_bytes += length;
        Ok(())
    }

    fn settle(&self, length: u64, admitted: Option<(String, Source)>) -> Result<(), RpcError> {
        let mut ledger = self.ledger()?;
        ledger.reserved_count -= 1;
        ledger.reserved_bytes -= length;
        if let Some((token, source)) = admitted {
            ledger.sources.insert(token, source);
        }
        Ok(())
    }

    pub fn open(
        &self,
        snapshot_dir: &Path,
        path: &Path,
        window: &str,
        admission: &Admission,
    ) -> Result<Option<ViewSource>, RpcError> {
        let metadata = std::fs::metadata(path).map_err(io_error)?;
        if !metadata.is_file() {
            return Err(RpcError::new("FILE_NOT_FOUND", "not a file"));
        }
        let expected = metadata.len();
        if expected < admission.threshold {
            return Ok(None);
        }
        self.reserve(expected, admission)?;
        let token = uuid::Uuid::new_v4().to_string();
        let snapshot = snapshot_dir.join(format!("{token}.pdf"));
        let copied = create_private_dir(snapshot_dir)
            .and_then(|()| std::fs::copy(path, &snapshot))
            .map_err(io_error)
            .and_then(|length| match length {
                0 => Err(RpcError::new("INVALID_PDF", "the file is empty")),
                length if length != expected => Err(RpcError::new(
                    "INVALID_PARAMS",
                    "the file changed while it was being opened",
                )),
                length => Ok(length),
            });
        match copied {
            Ok(length) => {
                let source = Source {
                    snapshot,
                    length,
                    window: window.to_string(),
                };
                self.settle(expected, Some((token.clone(), source)))?;
                Ok(Some(ViewSource { token, length }))
            }
            Err(error) => {
                remove_snapshot(&snapshot);
                self.settle(expected, None)?;
                Err(error)
            }
        }
    }

    pub fn release(&self, token: &str, window: &str) {
        let removed = self.0.lock().ok().and_then(|mut ledger| {
            let owned = ledger
                .sources
                .get(token)
                .is_some_and(|source| source.window == window);
            owned.then(|| ledger.sources.remove(token)).flatten()
        });
        if let Some(source) = removed {
            remove_snapshot(&source.snapshot);
        }
    }

    pub fn release_window(&self, window: &str) {
        let removed: Vec<Source> = match self.0.lock() {
            Ok(mut ledger) => {
                let tokens: Vec<String> = ledger
                    .sources
                    .iter()
                    .filter(|(_, source)| source.window == window)
                    .map(|(token, _)| token.clone())
                    .collect();
                tokens
                    .iter()
                    .filter_map(|token| ledger.sources.remove(token))
                    .collect()
            }
            Err(_) => Vec::new(),
        };
        for source in removed {
            remove_snapshot(&source.snapshot);
        }
    }

    fn lookup(&self, token: &str, window: &str) -> Option<(PathBuf, u64)> {
        let ledger = self.0.lock().ok()?;
        ledger
            .sources
            .get(token)
            .filter(|source| source.window == window)
            .map(|source| (source.snapshot.clone(), source.length))
    }
}

fn snapshot_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, RpcError> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join(SNAPSHOT_DIR_NAME))
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

#[cfg(windows)]
fn free_space(dir: &Path) -> Option<u64> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let mut available = 0u64;
    // SAFETY: the path is a NUL-terminated HSTRING that outlives the call and `available` is a valid, writable u64.
    unsafe {
        GetDiskFreeSpaceExW(
            &HSTRING::from(dir.as_os_str()),
            Some(&mut available),
            None,
            None,
        )
    }
    .ok()?;
    Some(available)
}

#[cfg(not(windows))]
fn free_space(_dir: &Path) -> Option<u64> {
    None
}

pub fn clear_snapshots<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(dir) = snapshot_dir(app) {
        if let Err(error) = std::fs::remove_dir_all(&dir) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!("[view] could not clear view snapshots: {error}");
            }
        }
    }
}

#[tauri::command]
pub async fn view_source<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::Window<R>,
    path: String,
) -> Result<Option<ViewSource>, RpcError> {
    let dir = snapshot_dir(&app)?;
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let parent = dir.parent().unwrap_or(&dir);
        let admission = Admission {
            threshold: LARGE_VIEW_BYTES,
            budget_bytes: BUDGET_BYTES,
            free_space: free_space(parent),
        };
        let sources = app.state::<ViewSources>();
        let opened = sources.open(&dir, Path::new(&path), &label, &admission)?;
        if opened.is_some() && app.get_webview_window(&label).is_none() {
            sources.release_window(&label);
            return Err(RpcError::new("INTERNAL", "the window closed"));
        }
        Ok(opened)
    })
    .await
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?
}

#[tauri::command]
pub fn view_source_release<R: Runtime>(
    window: tauri::Window<R>,
    sources: tauri::State<'_, ViewSources>,
    token: String,
) {
    sources.release(&token, window.label());
}

pub(crate) fn allowed_origin(request: &Request<Vec<u8>>, dev: bool) -> Option<HeaderValue> {
    let origin = request.headers().get(header::ORIGIN)?;
    let url = Url::parse(origin.to_str().ok()?).ok()?;
    let bare = matches!(url.path(), "" | "/") && url.query().is_none() && url.fragment().is_none();
    (bare && is_app_url(&url, dev)).then(|| origin.clone())
}

fn token_of(request: &Request<Vec<u8>>) -> Option<&str> {
    let token = request.uri().path().trim_start_matches('/');
    uuid::Uuid::parse_str(token).ok().map(|_| token)
}

fn parse_range(value: &str, length: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end: u64 = match end.trim() {
        "" => length.checked_sub(1)?,
        text => text.parse::<u64>().ok()?.min(length.checked_sub(1)?),
    };
    (start <= end && end < length && end - start < MAX_RANGE_BYTES).then_some((start, end))
}

fn read_range(path: &Path, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = vec![0; (end - start + 1) as usize];
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

pub(crate) fn reply(
    status: StatusCode,
    origin: Option<&HeaderValue>,
) -> tauri::http::response::Builder {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .header(header::VARY, "Origin");
    if let Some(origin) = origin {
        builder = builder
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                "Content-Range, Content-Length, Accept-Ranges",
            );
    }
    builder
}

pub(crate) fn empty(builder: tauri::http::response::Builder) -> Response<Vec<u8>> {
    builder.body(Vec::new()).unwrap_or_default()
}

pub fn respond(
    sources: &ViewSources,
    request: &Request<Vec<u8>>,
    window: &str,
    dev: bool,
) -> Response<Vec<u8>> {
    let Some(origin) = allowed_origin(request, dev) else {
        return empty(reply(StatusCode::FORBIDDEN, None));
    };
    let origin = Some(&origin);
    if request.method() == Method::OPTIONS {
        return empty(
            reply(StatusCode::NO_CONTENT, origin)
                .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD")
                .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
                .header(header::ACCESS_CONTROL_MAX_AGE, "600"),
        );
    }
    let Some((snapshot, length)) =
        token_of(request).and_then(|token| sources.lookup(token, window))
    else {
        return empty(reply(StatusCode::NOT_FOUND, origin));
    };
    if request.method() == Method::HEAD {
        return empty(
            reply(StatusCode::OK, origin)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, length),
        );
    }
    if request.method() != Method::GET {
        return empty(
            reply(StatusCode::METHOD_NOT_ALLOWED, origin).header(header::ALLOW, "GET, HEAD"),
        );
    }
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, length));
    let Some((start, end)) = range else {
        return empty(
            reply(StatusCode::RANGE_NOT_SATISFIABLE, origin)
                .header(header::CONTENT_RANGE, format!("bytes */{length}")),
        );
    };
    match read_range(&snapshot, start, end) {
        Ok(bytes) => reply(StatusCode::PARTIAL_CONTENT, origin)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header(header::ACCEPT_RANGES, "bytes")
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{length}"),
            )
            .header(header::CONTENT_LENGTH, bytes.len())
            .body(bytes)
            .unwrap_or_default(),
        Err(error) => {
            eprintln!("[view] could not read a view snapshot: {error}");
            empty(reply(StatusCode::INTERNAL_SERVER_ERROR, origin))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP_ORIGIN: &str = "http://tauri.localhost";
    const ANY_SIZE: Admission = Admission {
        threshold: 1,
        budget_bytes: u64::MAX,
        free_space: None,
    };

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("vivepdf-view-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        }

        fn snapshots(&self) -> PathBuf {
            self.0.join("snapshots")
        }

        fn snapshot_count(&self) -> usize {
            std::fs::read_dir(self.snapshots())
                .map(|entries| entries.count())
                .unwrap_or(0)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn content() -> Vec<u8> {
        (0..=255u8).cycle().take(4096).collect()
    }

    fn opened(sources: &ViewSources, scratch: &Scratch, window: &str) -> ViewSource {
        let path = scratch.file(&format!("{window}.pdf"), &content());
        sources
            .open(&scratch.snapshots(), &path, window, &ANY_SIZE)
            .unwrap()
            .unwrap()
    }

    fn request(
        method: Method,
        token: &str,
        origin: Option<&str>,
        range: Option<&str>,
    ) -> Request<Vec<u8>> {
        let mut builder = Request::builder()
            .method(method)
            .uri(format!("http://vivepdf-view.localhost/{token}"));
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        if let Some(range) = range {
            builder = builder.header(header::RANGE, range);
        }
        builder.body(Vec::new()).unwrap()
    }

    fn get(sources: &ViewSources, token: &str, window: &str, range: &str) -> Response<Vec<u8>> {
        respond(
            sources,
            &request(Method::GET, token, Some(APP_ORIGIN), Some(range)),
            window,
            false,
        )
    }

    fn header_of(response: &Response<Vec<u8>>, name: header::HeaderName) -> &str {
        response.headers().get(name).unwrap().to_str().unwrap()
    }

    #[test]
    fn a_large_file_is_served_from_a_snapshot_in_ranges() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let source = opened(&sources, &scratch, "main");
        assert_eq!(source.length, 4096);

        let response = get(&sources, &source.token, "main", "bytes=10-19");

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), &content()[10..20]);
        assert_eq!(
            header_of(&response, header::CONTENT_RANGE),
            "bytes 10-19/4096"
        );
        assert_eq!(
            header_of(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN),
            APP_ORIGIN
        );
        assert_eq!(
            header_of(&response, "cross-origin-resource-policy".parse().unwrap()),
            "same-origin"
        );
    }

    #[test]
    fn the_snapshot_keeps_the_bytes_the_file_had_when_it_was_opened() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let source = opened(&sources, &scratch, "main");
        std::fs::write(scratch.0.join("main.pdf"), b"overwritten").unwrap();

        let response = get(&sources, &source.token, "main", "bytes=0-3");

        assert_eq!(response.body(), &content()[0..4]);
    }

    #[test]
    fn head_and_preflight_describe_the_file_without_a_body() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let source = opened(&sources, &scratch, "main");

        let head = respond(
            &sources,
            &request(Method::HEAD, &source.token, Some(APP_ORIGIN), None),
            "main",
            false,
        );
        let preflight = respond(
            &sources,
            &request(Method::OPTIONS, &source.token, Some(APP_ORIGIN), None),
            "main",
            false,
        );

        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(header_of(&head, header::CONTENT_LENGTH), "4096");
        assert!(head.body().is_empty());
        assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            header_of(&preflight, header::ACCESS_CONTROL_ALLOW_HEADERS),
            "Range"
        );
    }

    #[test]
    fn a_small_file_is_left_to_the_ordinary_reader() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let path = scratch.file("small.pdf", b"%PDF-1.7");
        let admission = Admission {
            threshold: 1024,
            ..ANY_SIZE
        };

        assert_eq!(
            sources
                .open(&scratch.snapshots(), &path, "main", &admission)
                .unwrap(),
            None
        );
        assert!(!scratch.snapshots().exists());
    }

    #[test]
    fn a_missing_file_or_a_folder_is_refused() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();

        let missing = sources.open(
            &scratch.snapshots(),
            &scratch.0.join("gone.pdf"),
            "main",
            &ANY_SIZE,
        );
        let folder = sources.open(&scratch.snapshots(), &scratch.0, "main", &ANY_SIZE);

        assert_eq!(missing.unwrap_err().code, "FILE_NOT_FOUND");
        assert_eq!(folder.unwrap_err().code, "FILE_NOT_FOUND");
    }

    #[test]
    fn other_origins_windows_and_unknown_tokens_get_nothing() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let source = opened(&sources, &scratch, "main");
        let range = Some("bytes=0-9");
        let ask = |origin: Option<&str>, dev: bool| {
            respond(
                &sources,
                &request(Method::GET, &source.token, origin, range),
                "main",
                dev,
            )
        };

        for refused in [
            ask(Some("https://example.com"), true),
            ask(None, true),
            ask(Some("null"), true),
            ask(Some("http://localhost:1420"), false),
            ask(Some("http://tauri.localhost:8080"), true),
            ask(Some("tauri://localhost:1234"), true),
            ask(Some("https://tauri.localhost"), true),
        ] {
            assert_eq!(refused.status(), StatusCode::FORBIDDEN);
            assert!(refused.body().is_empty());
            assert!(refused
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none());
        }
        assert_eq!(
            ask(Some("tauri://localhost"), false).status(),
            StatusCode::PARTIAL_CONTENT
        );
        assert_eq!(
            get(&sources, &source.token, "doc-7", "bytes=0-9").status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get(
                &sources,
                &uuid::Uuid::new_v4().to_string(),
                "main",
                "bytes=0-9"
            )
            .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get(&sources, "..%2F..%2Fsecret", "main", "bytes=0-9").status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn only_bounded_single_ranges_are_read() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let source = opened(&sources, &scratch, "main");
        let ask = |range: Option<&str>| {
            respond(
                &sources,
                &request(Method::GET, &source.token, Some(APP_ORIGIN), range),
                "main",
                false,
            )
        };

        assert_eq!(ask(Some("bytes=4000-")).body(), &content()[4000..]);
        assert_eq!(ask(Some("bytes=4090-9999")).body(), &content()[4090..]);
        for refused in [
            None,
            Some("bytes=10-5"),
            Some("bytes=4096-4100"),
            Some("bytes=0-1,5-6"),
            Some("bytes=-10"),
            Some("items=0-1"),
        ] {
            let response = ask(refused);
            assert_eq!(
                response.status(),
                StatusCode::RANGE_NOT_SATISFIABLE,
                "{refused:?}"
            );
            assert_eq!(header_of(&response, header::CONTENT_RANGE), "bytes */4096");
        }
        assert_eq!(parse_range("bytes=0-", MAX_RANGE_BYTES + 10), None);
        assert_eq!(
            parse_range(
                &format!("bytes=0-{}", MAX_RANGE_BYTES - 1),
                MAX_RANGE_BYTES + 10
            ),
            Some((0, MAX_RANGE_BYTES - 1))
        );
        let post = respond(
            &sources,
            &request(Method::POST, &source.token, Some(APP_ORIGIN), None),
            "main",
            false,
        );
        assert_eq!(post.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[test]
    fn only_the_owning_window_releases_a_token_and_closing_it_releases_all() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let first = opened(&sources, &scratch, "main");
        let second = opened(&sources, &scratch, "doc-1");
        let third = opened(&sources, &scratch, "doc-1");
        let snapshot =
            |source: &ViewSource| scratch.snapshots().join(format!("{}.pdf", source.token));

        sources.release(&first.token, "doc-1");
        assert!(snapshot(&first).exists());
        sources.release(&first.token, "main");
        sources.release_window("doc-1");
        sources.release("never-issued", "main");

        for (source, window) in [(&first, "main"), (&second, "doc-1"), (&third, "doc-1")] {
            assert!(!snapshot(source).exists());
            assert_eq!(
                get(&sources, &source.token, window, "bytes=0-1").status(),
                StatusCode::NOT_FOUND
            );
        }
    }

    #[test]
    fn open_sources_are_capped_by_count_bytes_and_free_space() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let path = scratch.file("big.pdf", &content());
        for _ in 0..MAX_SOURCES {
            sources
                .open(&scratch.snapshots(), &path, "main", &ANY_SIZE)
                .unwrap();
        }
        let by_count = sources
            .open(&scratch.snapshots(), &path, "main", &ANY_SIZE)
            .unwrap_err();
        sources.release_window("main");
        let tight = Admission {
            budget_bytes: 4096 * 2,
            ..ANY_SIZE
        };
        sources
            .open(&scratch.snapshots(), &path, "main", &tight)
            .unwrap();
        sources
            .open(&scratch.snapshots(), &path, "main", &tight)
            .unwrap();
        let by_bytes = sources
            .open(&scratch.snapshots(), &path, "main", &tight)
            .unwrap_err();
        let low_disk = Admission {
            free_space: Some(FREE_SPACE_MARGIN),
            ..ANY_SIZE
        };
        let by_space = sources
            .open(&scratch.snapshots(), &path, "doc-2", &low_disk)
            .unwrap_err();

        for refused in [&by_count, &by_bytes, &by_space] {
            assert_eq!(refused.code, "INVALID_PARAMS");
        }
        assert_eq!(scratch.snapshot_count(), 2);
    }

    #[test]
    fn parallel_opens_cannot_pass_the_limits_together() {
        let scratch = Scratch::new();
        let sources = ViewSources::default();
        let path = scratch.file("big.pdf", &content());
        let tight = Admission {
            budget_bytes: 4096 * 3,
            ..ANY_SIZE
        };

        let admitted = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..16)
                .map(|_| {
                    scope.spawn(|| {
                        sources
                            .open(&scratch.snapshots(), &path, "main", &tight)
                            .is_ok()
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .filter(|ok| *ok)
                .count()
        });

        assert_eq!(admitted, 3);
        assert_eq!(scratch.snapshot_count(), 3);
        let ledger = sources.0.lock().unwrap();
        assert_eq!((ledger.reserved_count, ledger.reserved_bytes), (0, 0));
    }
}

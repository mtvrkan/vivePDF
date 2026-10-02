use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Deserialize;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Runtime};

use crate::view_source::{allowed_origin, empty, reply};

pub const SCHEME: &str = "vivepdf-font";
pub const MISSING_EVENT: &str = "fallback-font-missing";
const MANIFEST: &str = include_str!("../../src/features/viewer/pdf/fallbackFonts.json");
const FONTS_DIR_NAME: &str = "fallback-fonts";

#[derive(Deserialize)]
struct Manifest {
    directory: String,
    sets: Vec<ManifestSet>,
}

#[derive(Deserialize)]
struct ManifestSet {
    id: String,
    bundled: bool,
    files: Vec<ManifestFile>,
}

#[derive(Deserialize)]
struct ManifestFile {
    file: String,
}

struct Font {
    set: String,
    bundled: bool,
}

struct Catalogue {
    directory: String,
    fonts: HashMap<String, Font>,
}

fn catalogue() -> &'static Catalogue {
    static CATALOGUE: OnceLock<Catalogue> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        let manifest: Manifest =
            serde_json::from_str(MANIFEST).expect("fallbackFonts.json is valid");
        let fonts = manifest
            .sets
            .iter()
            .flat_map(|set| {
                set.files.iter().map(|entry| {
                    (
                        entry.file.clone(),
                        Font {
                            set: set.id.clone(),
                            bundled: set.bundled,
                        },
                    )
                })
            })
            .collect();
        Catalogue {
            directory: manifest.directory,
            fonts,
        }
    })
}

fn present(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.is_empty())
}

pub fn data_dir(var: impl Fn(&str) -> Option<String>) -> Option<PathBuf> {
    if let Some(dir) = present(var("VIVEPDF_DATA_DIR")) {
        return Some(PathBuf::from(dir));
    }
    if cfg!(windows) {
        let base = present(var("LOCALAPPDATA"))
            .map(PathBuf::from)
            .or_else(|| {
                present(var("USERPROFILE"))
                    .map(|home| PathBuf::from(home).join("AppData").join("Local"))
            })?;
        return Some(base.join("vivePDF"));
    }
    let home = present(var("HOME")).map(PathBuf::from);
    if cfg!(target_os = "macos") {
        return home.map(|home| {
            home.join("Library")
                .join("Application Support")
                .join("vivePDF")
        });
    }
    present(var("XDG_DATA_HOME"))
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .or_else(|| home.map(|home| home.join(".local").join("share")))
        .map(|dir| dir.join("vivepdf"))
}

pub fn fonts_dir() -> Option<PathBuf> {
    data_dir(|name| std::env::var(name).ok()).map(|dir| dir.join(FONTS_DIR_NAME))
}

pub fn bundled_font<R: Runtime>(app: &AppHandle<R>, name: &str) -> Option<Vec<u8>> {
    let key = format!("{}/{name}", catalogue().directory);
    if let Some(asset) = app.asset_resolver().get(key.clone()) {
        return Some(asset.bytes().to_vec());
    }
    if cfg!(debug_assertions) {
        let public = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public");
        return std::fs::read(public.join(key)).ok();
    }
    None
}

fn content_type(name: &str) -> &'static str {
    if name.ends_with(".ttf") {
        "font/ttf"
    } else {
        "font/otf"
    }
}

pub struct Outcome {
    pub response: Response<Vec<u8>>,
    pub missing: Option<String>,
}

fn answer(response: Response<Vec<u8>>) -> Outcome {
    Outcome {
        response,
        missing: None,
    }
}

pub fn respond(
    request: &Request<Vec<u8>>,
    dev: bool,
    fonts_dir: Option<&Path>,
    bundled: impl Fn(&str) -> Option<Vec<u8>>,
) -> Outcome {
    let Some(origin) = allowed_origin(request, dev) else {
        return answer(empty(reply(StatusCode::FORBIDDEN, None)));
    };
    let origin = Some(&origin);
    if request.method() == Method::OPTIONS {
        return answer(empty(
            reply(StatusCode::NO_CONTENT, origin)
                .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET")
                .header(header::ACCESS_CONTROL_MAX_AGE, "600"),
        ));
    }
    if request.method() != Method::GET {
        return answer(empty(
            reply(StatusCode::METHOD_NOT_ALLOWED, origin).header(header::ALLOW, "GET"),
        ));
    }
    let name = request.uri().path().trim_start_matches('/');
    let Some(font) = catalogue().fonts.get(name) else {
        return answer(empty(reply(StatusCode::NOT_FOUND, origin)));
    };
    let bytes = if font.bundled {
        bundled(name)
    } else {
        fonts_dir.and_then(|dir| std::fs::read(dir.join(name)).ok())
    };
    match bytes {
        Some(bytes) => answer(
            reply(StatusCode::OK, origin)
                .header(header::CONTENT_TYPE, content_type(name))
                .header(header::CONTENT_LENGTH, bytes.len())
                .body(bytes)
                .unwrap_or_default(),
        ),
        None => Outcome {
            response: empty(reply(StatusCode::NOT_FOUND, origin)),
            missing: (!font.bundled).then(|| font.set.clone()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP_ORIGIN: &str = "http://tauri.localhost";
    const JAPANESE: &str = "NotoSansJP-Regular.otf";
    const LATIN: &str = "NotoSans-Regular.ttf";

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("vivepdf-font-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn request(method: Method, name: &str, origin: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder()
            .method(method)
            .uri(format!("http://vivepdf-font.localhost/{name}"));
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        builder.body(Vec::new()).unwrap()
    }

    fn get(name: &str, dir: Option<&Path>) -> Outcome {
        respond(
            &request(Method::GET, name, Some(APP_ORIGIN)),
            false,
            dir,
            |file| (file == LATIN).then(|| b"latin".to_vec()),
        )
    }

    #[test]
    fn a_bundled_font_is_served_from_the_app_assets() {
        let outcome = get(LATIN, None);

        assert_eq!(outcome.response.status(), StatusCode::OK);
        assert_eq!(outcome.response.body(), b"latin");
        assert_eq!(
            outcome
                .response
                .headers()
                .get(header::CONTENT_TYPE)
                .unwrap(),
            "font/ttf"
        );
        assert_eq!(
            outcome
                .response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            APP_ORIGIN
        );
        assert!(outcome.missing.is_none());
    }

    #[test]
    fn a_downloaded_font_is_served_from_the_fonts_folder() {
        let scratch = Scratch::new();
        std::fs::write(scratch.0.join(JAPANESE), b"japanese").unwrap();

        let outcome = get(JAPANESE, Some(&scratch.0));

        assert_eq!(outcome.response.status(), StatusCode::OK);
        assert_eq!(outcome.response.body(), b"japanese");
        assert_eq!(
            outcome
                .response
                .headers()
                .get(header::CONTENT_TYPE)
                .unwrap(),
            "font/otf"
        );
        assert!(outcome.missing.is_none());
    }

    #[test]
    fn a_font_not_downloaded_yet_names_its_set() {
        let scratch = Scratch::new();

        let outcome = get(JAPANESE, Some(&scratch.0));
        let without_folder = get("NotoSansHans-Regular.otf", None);

        assert_eq!(outcome.response.status(), StatusCode::NOT_FOUND);
        assert_eq!(outcome.missing.as_deref(), Some("ja"));
        assert_eq!(without_folder.missing.as_deref(), Some("zh-Hans"));
    }

    #[test]
    fn only_catalogue_names_are_read_and_nothing_else_is_reported() {
        let scratch = Scratch::new();
        std::fs::write(scratch.0.join("secret.txt"), b"secret").unwrap();

        for name in [
            "secret.txt",
            "../secret.txt",
            "..%2Fsecret.txt",
            "sub/NotoSansJP-Regular.otf",
            "",
        ] {
            let outcome = get(name, Some(&scratch.0));
            assert_eq!(outcome.response.status(), StatusCode::NOT_FOUND, "{name}");
            assert!(outcome.response.body().is_empty());
            assert!(outcome.missing.is_none(), "{name}");
        }
    }

    #[test]
    fn other_origins_and_methods_get_nothing() {
        for origin in [None, Some("https://example.com"), Some("null")] {
            let outcome = respond(&request(Method::GET, LATIN, origin), false, None, |_| {
                Some(b"latin".to_vec())
            });
            assert_eq!(outcome.response.status(), StatusCode::FORBIDDEN);
            assert!(outcome.missing.is_none());
        }
        let post = respond(
            &request(Method::POST, LATIN, Some(APP_ORIGIN)),
            false,
            None,
            |_| Some(b"latin".to_vec()),
        );
        assert_eq!(post.response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[test]
    fn the_fonts_folder_follows_the_engine_data_folder() {
        let lookup = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| value.to_string())
            }
        };

        assert_eq!(
            data_dir(lookup(&[("VIVEPDF_DATA_DIR", "/run/engine-data")])),
            Some(PathBuf::from("/run/engine-data"))
        );
        if cfg!(windows) {
            assert_eq!(
                data_dir(lookup(&[("LOCALAPPDATA", r"C:\Users\a\AppData\Local")])),
                Some(PathBuf::from(r"C:\Users\a\AppData\Local").join("vivePDF"))
            );
            assert_eq!(
                data_dir(lookup(&[
                    ("VIVEPDF_DATA_DIR", ""),
                    ("USERPROFILE", r"C:\Users\a")
                ])),
                Some(
                    PathBuf::from(r"C:\Users\a")
                        .join("AppData")
                        .join("Local")
                        .join("vivePDF")
                )
            );
        } else if cfg!(target_os = "macos") {
            assert_eq!(
                data_dir(lookup(&[("HOME", "/Users/a")])),
                Some(PathBuf::from(
                    "/Users/a/Library/Application Support/vivePDF"
                ))
            );
        } else {
            assert_eq!(
                data_dir(lookup(&[
                    ("HOME", "/home/a"),
                    ("XDG_DATA_HOME", "relative")
                ])),
                Some(PathBuf::from("/home/a/.local/share/vivepdf"))
            );
            assert_eq!(
                data_dir(lookup(&[("HOME", "/home/a"), ("XDG_DATA_HOME", "/data")])),
                Some(PathBuf::from("/data/vivepdf"))
            );
        }
        assert_eq!(data_dir(|_| None), None);
    }

    #[test]
    fn the_catalogue_knows_every_fallback_file() {
        let fonts = &catalogue().fonts;
        assert_eq!(fonts.len(), 6);
        assert!(fonts[LATIN].bundled);
        assert_eq!(fonts[JAPANESE].set, "ja");
        assert!(!fonts[JAPANESE].bundled);
    }
}

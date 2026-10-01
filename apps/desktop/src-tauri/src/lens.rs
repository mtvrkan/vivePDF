use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::rpc::RpcError;

const LENS_UPLOAD_URL: &str = "https://lens.google.com/v3/upload";
const LENS_FOLDER: &str = "vivepdf-lens";
const PAGE_PREFIX: &str = "lens-";
const PAGE_EXTENSION: &str = "html";
const MAX_PICTURE_BASE64: usize = 40 * 1024 * 1024;

fn is_png_base64(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PICTURE_BASE64
        && value.len().is_multiple_of(4)
        && value.starts_with("iVBORw0KGgo")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

fn upload_page(png_base64: &str, width: u32, height: u32, stamp: u128) -> String {
    format!(
        r#"<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Google Lens</title></head>
<body>
<form id="lens" method="post" enctype="multipart/form-data" action="{LENS_UPLOAD_URL}?ep=ccm&amp;s=&amp;st={stamp}">
<input type="file" name="encoded_image" hidden>
<input type="hidden" name="processed_image_dimensions" value="{width},{height}">
</form>
<script>
const bytes = Uint8Array.from(atob("{png_base64}"), (character) => character.charCodeAt(0));
const transfer = new DataTransfer();
transfer.items.add(new File([bytes], "image.png", {{ type: "image/png" }}));
const form = document.getElementById("lens");
form.elements.encoded_image.files = transfer.files;
form.submit();
</script>
</body>
</html>
"#
    )
}

fn is_upload_page(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase());
    name.is_some_and(|name| {
        name.starts_with(PAGE_PREFIX) && name.ends_with(&format!(".{PAGE_EXTENSION}"))
    })
}

fn drop_old_pages(folder: &Path) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_upload_page(&path) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn write_upload_page(
    folder: &Path,
    png_base64: &str,
    width: u32,
    height: u32,
) -> Result<PathBuf, RpcError> {
    if !is_png_base64(png_base64) {
        return Err(RpcError::new(
            "INVALID_PARAMS",
            "picture is not a PNG in base64",
        ));
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    std::fs::create_dir_all(folder)
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    drop_old_pages(folder);
    let page = folder.join(format!("{PAGE_PREFIX}{stamp}.{PAGE_EXTENSION}"));
    std::fs::write(&page, upload_page(png_base64, width, height, stamp))
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    Ok(page)
}

#[tauri::command]
pub async fn search_picture_with_lens(
    app: tauri::AppHandle,
    png_base64: String,
    width: u32,
    height: u32,
) -> Result<(), RpcError> {
    use tauri_plugin_opener::OpenerExt;
    let page = tauri::async_runtime::spawn_blocking(move || {
        write_upload_page(
            &std::env::temp_dir().join(LENS_FOLDER),
            &png_base64,
            width,
            height,
        )
    })
    .await
    .map_err(|error| RpcError::new("INTERNAL", error.to_string()))??;
    app.opener()
        .open_path(page.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| RpcError::new("INTERNAL", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PIXEL: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    fn temp_folder(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("vivepdf-lens-test-{label}-{nanos}"))
    }

    #[test]
    fn only_png_base64_is_accepted() {
        assert!(is_png_base64(PIXEL));
        assert!(!is_png_base64(""));
        assert!(!is_png_base64("/9j/4AAQSkZJRgABAQ=="));
        assert!(!is_png_base64("iVBORw0KGgo\");alert(1);//AA"));
        assert!(!is_png_base64("iVBORw0KGgoAAA"));
    }

    #[test]
    fn page_posts_the_picture_to_lens() {
        let page = upload_page(PIXEL, 640, 480, 42);
        assert!(
            page.contains(r#"action="https://lens.google.com/v3/upload?ep=ccm&amp;s=&amp;st=42""#)
        );
        assert!(page.contains(r#"name="encoded_image""#));
        assert!(page.contains(r#"value="640,480""#));
        assert!(page.contains(&format!(r#"atob("{PIXEL}")"#)));
        assert!(page.contains(r#"{ type: "image/png" }"#));
    }

    #[test]
    fn writing_a_page_replaces_the_previous_one() {
        let folder = temp_folder("replace");
        let first = write_upload_page(&folder, PIXEL, 1, 1).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = write_upload_page(&folder, PIXEL, 1, 1).unwrap();
        assert!(!first.exists());
        assert!(second.is_file());
        std::fs::write(folder.join("keep.txt"), "x").unwrap();
        write_upload_page(&folder, PIXEL, 1, 1).unwrap();
        assert!(folder.join("keep.txt").is_file());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_non_png_picture_is_refused_before_anything_is_written() {
        let folder = temp_folder("refuse");
        let error = write_upload_page(&folder, "not base64", 1, 1).unwrap_err();
        assert_eq!(error.code, "INVALID_PARAMS");
        assert!(!folder.exists());
    }
}

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

const DEV_ORIGIN: (&str, &str, u16) = ("http", "localhost", 1420);

pub(crate) fn is_app_url(url: &Url, dev: bool) -> bool {
    let host = url.host_str().unwrap_or_default();
    match url.scheme() {
        "tauri" => host == "localhost" && url.port().is_none(),
        "http" if host == "tauri.localhost" => url.port().is_none(),
        scheme => dev && (scheme, host, url.port().unwrap_or_default()) == DEV_ORIGIN,
    }
}

pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|_, url| is_app_url(url, cfg!(debug_assertions)))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn the_app_itself_may_be_shown() {
        assert!(is_app_url(&url("http://tauri.localhost/index.html"), false));
        assert!(is_app_url(&url("tauri://localhost/viewer"), false));
        assert!(is_app_url(&url("http://localhost:1420/"), true));
    }

    #[test]
    fn anything_else_is_kept_out_of_the_window() {
        assert!(!is_app_url(&url("https://example.com/"), true));
        assert!(!is_app_url(&url("http://localhost:1420/"), false));
        assert!(!is_app_url(&url("http://localhost:8080/"), true));
        assert!(!is_app_url(
            &url("http://tauri.localhost.example.com/"),
            true
        ));
        assert!(!is_app_url(&url("file:///C:/Windows/win.ini"), true));
        assert!(!is_app_url(&url("http://vivepdf-view.localhost/x"), true));
        assert!(!is_app_url(&url("http://tauri.localhost:8080/"), true));
        assert!(!is_app_url(&url("tauri://localhost:1234/"), true));
        assert!(!is_app_url(&url("https://tauri.localhost/"), true));
    }
}

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::autostart::started_in_background;
use crate::rpc::RpcError;

const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "tray-open";
const MENU_PAUSE: &str = "tray-pause";
const MENU_QUIT: &str = "tray-quit";
const MAX_LABEL_CHARS: usize = 64;
const MAX_TOOLTIP_CHARS: usize = 120;
const HIDDEN_START_GRACE: Duration = Duration::from_secs(20);

#[derive(Default)]
pub struct TrayState {
    active: AtomicBool,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub tooltip: String,
    pub open: String,
    pub pause: String,
    pub resume: String,
    pub quit: String,
}

fn is_label(value: &str, limit: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= limit
        && !value.chars().any(|character| character.is_control())
}

pub fn validate_labels(labels: &TrayLabels) -> Result<(), RpcError> {
    let menu_labels = [&labels.open, &labels.pause, &labels.resume, &labels.quit];
    if !is_label(&labels.tooltip, MAX_TOOLTIP_CHARS)
        || menu_labels
            .iter()
            .any(|label| !is_label(label, MAX_LABEL_CHARS))
    {
        return Err(RpcError::new("VALIDATION", "invalid tray labels"));
    }
    Ok(())
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());
    if let Some(window) = window {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main_window_hidden<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .is_some_and(|visible| !visible)
}

fn handle_menu<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_OPEN => show_main_window(app),
        MENU_PAUSE => {
            let _ = app.emit("tray-pause-toggle", ());
        }
        MENU_QUIT => {
            show_main_window(app);
            let _ = app.emit("quit-requested", ());
        }
        _ => {}
    }
}

fn handle_icon<R: Runtime>(tray: &TrayIcon<R>, event: TrayIconEvent) {
    if cfg!(target_os = "macos") {
        return;
    }
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_main_window(tray.app_handle());
    }
}

fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    labels: &TrayLabels,
    paused: bool,
) -> tauri::Result<Menu<R>> {
    let pause_label = if paused {
        &labels.resume
    } else {
        &labels.pause
    };
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, MENU_OPEN, &labels.open, true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_PAUSE, pause_label, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_QUIT, &labels.quit, true, None::<&str>)?,
        ],
    )
}

fn install<R: Runtime>(app: &AppHandle<R>, labels: &TrayLabels, paused: bool) -> tauri::Result<()> {
    let menu = build_menu(app, labels, paused)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
        tray.set_tooltip(Some(&labels.tooltip))?;
        return Ok(());
    }
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(&labels.tooltip)
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(handle_menu)
        .on_tray_icon_event(handle_icon);
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .icon(tauri::image::Image::from_bytes(include_bytes!(
                "../icons/tray-template.png"
            ))?)
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app).map(|_| ())
}

fn install_guarded<R: Runtime>(app: &AppHandle<R>, labels: &TrayLabels, paused: bool) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        install(app, labels, paused)
    }))
    .map(|result| result.is_ok())
    .unwrap_or(false)
}

#[tauri::command]
pub fn tray_configure<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TrayState>,
    enabled: bool,
    paused: bool,
    labels: TrayLabels,
) -> Result<bool, RpcError> {
    if enabled {
        validate_labels(&labels)?;
        if install_guarded(&app, &labels, paused) {
            state.active.store(true, Ordering::SeqCst);
            return Ok(true);
        }
    }
    let _ = app.remove_tray_by_id(TRAY_ID);
    state.active.store(false, Ordering::SeqCst);
    if main_window_hidden(&app) {
        show_main_window(&app);
    }
    Ok(false)
}

#[tauri::command]
pub fn window_hide_to_tray<R: Runtime>(app: AppHandle<R>, state: State<'_, TrayState>) -> bool {
    if !state.active.load(Ordering::SeqCst) || app.tray_by_id(TRAY_ID).is_none() {
        return false;
    }
    app.get_webview_window("main")
        .is_some_and(|window| window.hide().is_ok())
}

pub fn prepare_startup<R: Runtime>(app: &AppHandle<R>) {
    if !started_in_background(std::env::args().skip(1)) {
        show_main_window(app);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(HIDDEN_START_GRACE);
        let state = handle.state::<TrayState>();
        let tray_missing = !state.active.load(Ordering::SeqCst);
        if tray_missing && main_window_hidden(&handle) {
            show_main_window(&handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels() -> TrayLabels {
        TrayLabels {
            tooltip: "vivePDF — watching 2 folders".into(),
            open: "Open vivePDF".into(),
            pause: "Pause watching".into(),
            resume: "Resume watching".into(),
            quit: "Quit".into(),
        }
    }

    #[test]
    fn accepts_translated_labels() {
        let mut translated = labels();
        translated.pause = "İzlemeyi duraklat".into();
        assert!(validate_labels(&translated).is_ok());
    }

    #[test]
    fn refuses_empty_control_or_oversized_labels() {
        let mut empty = labels();
        empty.quit = "  ".into();
        assert!(validate_labels(&empty).is_err());
        let mut control = labels();
        control.open = "Open\nnow".into();
        assert!(validate_labels(&control).is_err());
        let mut long = labels();
        long.tooltip = "x".repeat(MAX_TOOLTIP_CHARS + 1);
        assert!(validate_labels(&long).is_err());
    }
}

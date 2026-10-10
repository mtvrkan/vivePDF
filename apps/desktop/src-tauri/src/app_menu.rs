use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use crate::rpc::RpcError;

#[cfg(target_os = "macos")]
const MENU_ABOUT: &str = "app-about";
#[cfg(target_os = "macos")]
const MENU_SETTINGS: &str = "app-settings";
#[cfg(target_os = "macos")]
const MENU_QUIT: &str = "app-quit";
const MAX_LABEL_CHARS: usize = 64;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppMenuLabels {
    pub about: String,
    pub settings: String,
    pub services: String,
    pub hide: String,
    pub hide_others: String,
    pub show_all: String,
    pub quit: String,
    pub edit: String,
    pub undo: String,
    pub redo: String,
    pub cut: String,
    pub copy: String,
    pub paste: String,
    pub select_all: String,
    pub window: String,
    pub minimize: String,
    pub zoom: String,
    pub close: String,
}

impl Default for AppMenuLabels {
    fn default() -> Self {
        Self {
            about: "About vivePDF".into(),
            settings: "Settings…".into(),
            services: "Services".into(),
            hide: "Hide vivePDF".into(),
            hide_others: "Hide Others".into(),
            show_all: "Show All".into(),
            quit: "Quit vivePDF".into(),
            edit: "Edit".into(),
            undo: "Undo".into(),
            redo: "Redo".into(),
            cut: "Cut".into(),
            copy: "Copy".into(),
            paste: "Paste".into(),
            select_all: "Select All".into(),
            window: "Window".into(),
            minimize: "Minimize".into(),
            zoom: "Zoom".into(),
            close: "Close Window".into(),
        }
    }
}

impl AppMenuLabels {
    fn all(&self) -> [&String; 18] {
        [
            &self.about,
            &self.settings,
            &self.services,
            &self.hide,
            &self.hide_others,
            &self.show_all,
            &self.quit,
            &self.edit,
            &self.undo,
            &self.redo,
            &self.cut,
            &self.copy,
            &self.paste,
            &self.select_all,
            &self.window,
            &self.minimize,
            &self.zoom,
            &self.close,
        ]
    }
}

pub fn validate_labels(labels: &AppMenuLabels) -> Result<(), RpcError> {
    let valid = labels.all().iter().all(|label| {
        !label.trim().is_empty()
            && label.chars().count() <= MAX_LABEL_CHARS
            && !label.chars().any(|character| character.is_control())
    });
    if !valid {
        return Err(RpcError::new("VALIDATION", "invalid menu labels"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn build<R: Runtime>(
    app: &AppHandle<R>,
    labels: &AppMenuLabels,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let name = app.package_info().name.clone();
    let application = Submenu::with_items(
        app,
        &name,
        true,
        &[
            &MenuItem::with_id(app, MENU_ABOUT, &labels.about, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_SETTINGS,
                &labels.settings,
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(&labels.services))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&labels.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(&labels.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(&labels.show_all))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_QUIT, &labels.quit, true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        &labels.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(&labels.undo))?,
            &PredefinedMenuItem::redo(app, Some(&labels.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(&labels.cut))?,
            &PredefinedMenuItem::copy(app, Some(&labels.copy))?,
            &PredefinedMenuItem::paste(app, Some(&labels.paste))?,
            &PredefinedMenuItem::select_all(app, Some(&labels.select_all))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        &labels.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(&labels.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(&labels.zoom))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(&labels.close))?,
        ],
    )?;
    Menu::with_items(app, &[&application, &edit, &window])
}

#[cfg(target_os = "macos")]
fn handle_menu<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    use tauri::Emitter;
    match event.id().as_ref() {
        MENU_ABOUT => {
            crate::tray::show_main_window(app);
            let _ = app.emit_to(crate::document_windows::MAIN_WINDOW, "app-menu", "about");
        }
        MENU_SETTINGS => {
            crate::tray::show_main_window(app);
            let _ = app.emit_to(crate::document_windows::MAIN_WINDOW, "app-menu", "settings");
        }
        MENU_QUIT => {
            crate::tray::show_main_window(app);
            let _ = app.emit("quit-requested", ());
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.on_menu_event(handle_menu);
    app.set_menu(build(app, &AppMenuLabels::default())?)
        .map(|_| ())
}

#[tauri::command]
pub fn app_menu_configure<R: Runtime>(
    app: AppHandle<R>,
    labels: AppMenuLabels,
) -> Result<(), RpcError> {
    validate_labels(&labels)?;
    #[cfg(target_os = "macos")]
    {
        let menu =
            build(&app, &labels).map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
        app.set_menu(menu)
            .map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_labels_are_valid() {
        assert!(validate_labels(&AppMenuLabels::default()).is_ok());
    }

    #[test]
    fn rejects_empty_or_multiline_labels() {
        let blank = AppMenuLabels {
            quit: "  ".into(),
            ..AppMenuLabels::default()
        };
        assert!(validate_labels(&blank).is_err());
        let multiline = AppMenuLabels {
            copy: "Copy\nPaste".into(),
            ..AppMenuLabels::default()
        };
        assert!(validate_labels(&multiline).is_err());
        let long = AppMenuLabels {
            edit: "x".repeat(MAX_LABEL_CHARS + 1),
            ..AppMenuLabels::default()
        };
        assert!(validate_labels(&long).is_err());
    }
}

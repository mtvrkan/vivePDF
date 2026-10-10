use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use crate::rpc::RpcError;

pub const QUIT_ID: &str = "app:quit";
const MAX_LABEL_CHARS: usize = 64;
const MAX_ID_CHARS: usize = 128;
const MAX_ACCELERATOR_CHARS: usize = 32;
const MAX_NODES: usize = 400;
const MAX_DEPTH: usize = 4;
const ROLES: [&str; 14] = [
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "selectAll",
    "minimize",
    "zoom",
    "closeWindow",
    "fullscreen",
    "services",
    "hide",
    "hideOthers",
    "showAll",
];

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MenuNode {
    #[serde(rename_all = "camelCase")]
    Item {
        id: String,
        label: String,
        #[serde(default)]
        accelerator: Option<String>,
    },
    Separator,
    #[serde(rename_all = "camelCase")]
    Predefined {
        role: String,
        #[serde(default)]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Submenu {
        label: String,
        items: Vec<MenuNode>,
    },
}

fn is_label(value: &str) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= MAX_LABEL_CHARS
        && !value.chars().any(|character| character.is_control())
}

fn is_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_CHARS
        && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn is_accelerator(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ACCELERATOR_CHARS
        && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn check(nodes: &[MenuNode], depth: usize, count: &mut usize) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    nodes.iter().all(|node| {
        *count += 1;
        *count <= MAX_NODES
            && match node {
                MenuNode::Item {
                    id,
                    label,
                    accelerator,
                } => {
                    is_id(id)
                        && is_label(label)
                        && accelerator.as_deref().is_none_or(is_accelerator)
                }
                MenuNode::Separator => true,
                MenuNode::Predefined { role, label } => {
                    ROLES.contains(&role.as_str()) && label.as_deref().is_none_or(is_label)
                }
                MenuNode::Submenu { label, items } => {
                    is_label(label) && check(items, depth + 1, count)
                }
            }
    })
}

pub fn validate_menu(menu: &[MenuNode]) -> Result<(), RpcError> {
    let top_level_submenus = !menu.is_empty()
        && menu
            .iter()
            .all(|node| matches!(node, MenuNode::Submenu { .. }));
    if !top_level_submenus || !check(menu, 1, &mut 0) {
        return Err(RpcError::new("VALIDATION", "invalid menu"));
    }
    Ok(())
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn item(id: &str, label: &str, accelerator: Option<&str>) -> MenuNode {
    MenuNode::Item {
        id: id.into(),
        label: label.into(),
        accelerator: accelerator.map(Into::into),
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn role(role: &str) -> MenuNode {
    MenuNode::Predefined {
        role: role.into(),
        label: None,
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn default_menu() -> Vec<MenuNode> {
    vec![
        MenuNode::Submenu {
            label: "vivePDF".into(),
            items: vec![
                role("services"),
                MenuNode::Separator,
                role("hide"),
                role("hideOthers"),
                role("showAll"),
                MenuNode::Separator,
                item(QUIT_ID, "Quit vivePDF", Some("CmdOrCtrl+Q")),
            ],
        },
        MenuNode::Submenu {
            label: "Edit".into(),
            items: vec![
                role("undo"),
                role("redo"),
                MenuNode::Separator,
                role("cut"),
                role("copy"),
                role("paste"),
                role("selectAll"),
            ],
        },
        MenuNode::Submenu {
            label: "Window".into(),
            items: vec![role("minimize"), role("zoom")],
        },
    ]
}

#[cfg(target_os = "macos")]
fn build_items<R: Runtime>(
    app: &AppHandle<R>,
    nodes: &[MenuNode],
) -> tauri::Result<Vec<Box<dyn tauri::menu::IsMenuItem<R>>>> {
    use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};
    let mut built: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::new();
    for node in nodes {
        match node {
            MenuNode::Item {
                id,
                label,
                accelerator,
            } => built.push(Box::new(MenuItem::with_id(
                app,
                id.as_str(),
                label,
                true,
                accelerator.as_deref(),
            )?)),
            MenuNode::Separator => built.push(Box::new(PredefinedMenuItem::separator(app)?)),
            MenuNode::Predefined { role, label } => {
                let text = label.as_deref();
                let predefined = match role.as_str() {
                    "undo" => PredefinedMenuItem::undo(app, text)?,
                    "redo" => PredefinedMenuItem::redo(app, text)?,
                    "cut" => PredefinedMenuItem::cut(app, text)?,
                    "copy" => PredefinedMenuItem::copy(app, text)?,
                    "paste" => PredefinedMenuItem::paste(app, text)?,
                    "selectAll" => PredefinedMenuItem::select_all(app, text)?,
                    "minimize" => PredefinedMenuItem::minimize(app, text)?,
                    "zoom" => PredefinedMenuItem::maximize(app, text)?,
                    "closeWindow" => PredefinedMenuItem::close_window(app, text)?,
                    "fullscreen" => PredefinedMenuItem::fullscreen(app, text)?,
                    "services" => PredefinedMenuItem::services(app, text)?,
                    "hide" => PredefinedMenuItem::hide(app, text)?,
                    "hideOthers" => PredefinedMenuItem::hide_others(app, text)?,
                    _ => PredefinedMenuItem::show_all(app, text)?,
                };
                built.push(Box::new(predefined));
            }
            MenuNode::Submenu { label, items } => {
                let children = build_items(app, items)?;
                let references: Vec<&dyn tauri::menu::IsMenuItem<R>> =
                    children.iter().map(|child| child.as_ref()).collect();
                built.push(Box::new(Submenu::with_items(
                    app,
                    label,
                    true,
                    &references,
                )?));
            }
        }
    }
    Ok(built)
}

#[cfg(target_os = "macos")]
fn build<R: Runtime>(
    app: &AppHandle<R>,
    nodes: &[MenuNode],
) -> tauri::Result<tauri::menu::Menu<R>> {
    let items = build_items(app, nodes)?;
    let references: Vec<&dyn tauri::menu::IsMenuItem<R>> =
        items.iter().map(|item| item.as_ref()).collect();
    tauri::menu::Menu::with_items(app, &references)
}

#[cfg(target_os = "macos")]
fn handle_menu<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    use tauri::{Emitter, Manager};
    let id = event.id().as_ref();
    if id.starts_with("tray-") {
        return;
    }
    if id == QUIT_ID {
        crate::tray::show_main_window(app);
        let _ = app.emit("quit-requested", ());
        return;
    }
    let target = app
        .webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
        .map(|window| window.label().to_string())
        .unwrap_or_else(|| {
            crate::tray::show_main_window(app);
            crate::document_windows::MAIN_WINDOW.to_string()
        });
    let _ = app.emit_to(target.as_str(), "app-menu", id);
}

#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.on_menu_event(handle_menu);
    app.set_menu(build(app, &default_menu())?).map(|_| ())
}

#[tauri::command]
pub fn app_menu_configure<R: Runtime>(
    app: AppHandle<R>,
    menu: Vec<MenuNode>,
) -> Result<(), RpcError> {
    validate_menu(&menu)?;
    #[cfg(target_os = "macos")]
    {
        let built =
            build(&app, &menu).map_err(|error| RpcError::new("INTERNAL", error.to_string()))?;
        app.set_menu(built)
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
    fn default_menu_is_valid() {
        assert!(validate_menu(&default_menu()).is_ok());
    }

    #[test]
    fn menu_nodes_parse_from_the_frontend_shape() {
        let menu: Vec<MenuNode> = serde_json::from_str(
            r#"[{"kind":"submenu","label":"File","items":[
                {"kind":"item","id":"key:meta+o","label":"Open PDF…","accelerator":"CmdOrCtrl+O"},
                {"kind":"separator"},
                {"kind":"predefined","role":"fullscreen","label":"Enter Full Screen"}]}]"#,
        )
        .unwrap();
        assert!(validate_menu(&menu).is_ok());
        assert_eq!(
            menu[0],
            MenuNode::Submenu {
                label: "File".into(),
                items: vec![
                    item("key:meta+o", "Open PDF…", Some("CmdOrCtrl+O")),
                    MenuNode::Separator,
                    MenuNode::Predefined {
                        role: "fullscreen".into(),
                        label: Some("Enter Full Screen".into()),
                    },
                ],
            }
        );
    }

    #[test]
    fn accepts_tool_groups_nested_under_go_tools() {
        let tool = item("nav:/tools/merge", "Merge", None);
        let group = MenuNode::Submenu {
            label: "Organize".into(),
            items: vec![tool],
        };
        let tools = MenuNode::Submenu {
            label: "Tools".into(),
            items: vec![group],
        };
        let go = MenuNode::Submenu {
            label: "Go".into(),
            items: vec![tools],
        };
        assert!(validate_menu(&[go]).is_ok());
    }

    #[test]
    fn rejects_bad_menus() {
        let submenu = |items| MenuNode::Submenu {
            label: "File".into(),
            items,
        };
        assert!(validate_menu(&[]).is_err());
        assert!(validate_menu(&[MenuNode::Separator]).is_err());
        assert!(validate_menu(&[submenu(vec![item("a", "  ", None)])]).is_err());
        assert!(validate_menu(&[submenu(vec![item("a", "Copy\nPaste", None)])]).is_err());
        assert!(validate_menu(&[submenu(vec![item("has space", "Open", None)])]).is_err());
        assert!(validate_menu(&[submenu(vec![role("format-disk")])]).is_err());
        let deep = submenu(vec![submenu(vec![submenu(vec![submenu(vec![submenu(
            vec![],
        )])])])]);
        assert!(validate_menu(&[deep]).is_err());
        let wide = submenu((0..MAX_NODES).map(|_| MenuNode::Separator).collect());
        assert!(validate_menu(&[wide]).is_err());
    }
}

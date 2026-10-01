use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{Runtime, State, WebviewWindow};

use crate::document_windows::{DocumentWindows, MAIN_WINDOW};

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub tool: Option<String>,
    pub paths: Vec<String>,
}

pub fn parse<I>(arguments: I, cwd: Option<&Path>) -> LaunchRequest
where
    I: IntoIterator<Item = String>,
{
    let mut tool = None;
    let mut paths = Vec::new();
    let mut iterator = arguments.into_iter();
    while let Some(argument) = iterator.next() {
        if argument == "--tool" {
            tool = iterator.next();
            continue;
        }
        if let Some(value) = argument.strip_prefix("--tool=") {
            tool = Some(value.to_string());
            continue;
        }
        if argument.starts_with('-') {
            continue;
        }
        let candidate = PathBuf::from(&argument);
        let resolved = match (candidate.is_relative(), cwd) {
            (true, Some(base)) => base.join(&candidate),
            _ => candidate,
        };
        if resolved.is_file() {
            paths.push(resolved.to_string_lossy().to_string());
        }
    }
    LaunchRequest { tool, paths }
}

#[tauri::command]
pub fn launch_request<R: Runtime>(
    window: WebviewWindow<R>,
    windows: State<'_, DocumentWindows>,
) -> LaunchRequest {
    if window.label() == MAIN_WINDOW {
        return parse(std::env::args().skip(1), None);
    }
    windows.request_for(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tool_flag_and_existing_files() {
        let directory = std::env::temp_dir().join("vivepdf-launch-test");
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("sample.pdf");
        std::fs::write(&file, b"%PDF-1.4").unwrap();
        let request = parse(
            vec![
                "--tool".to_string(),
                "compress".to_string(),
                "sample.pdf".to_string(),
                "missing.pdf".to_string(),
                "--flag".to_string(),
            ],
            Some(&directory),
        );
        assert_eq!(request.tool.as_deref(), Some("compress"));
        assert_eq!(request.paths, vec![file.to_string_lossy().to_string()]);
    }

    #[test]
    fn accepts_equals_form_without_files() {
        let request = parse(vec!["--tool=ocr".to_string()], None);
        assert_eq!(request.tool.as_deref(), Some("ocr"));
        assert!(request.paths.is_empty());
    }

    #[test]
    fn background_start_flag_is_not_read_as_a_file() {
        let request = parse(vec!["--background".to_string()], None);
        assert_eq!(
            request,
            LaunchRequest {
                tool: None,
                paths: Vec::new()
            }
        );
    }
}

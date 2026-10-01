import { getCurrentWindow } from "@tauri-apps/api/window";

export const MAIN_WINDOW_LABEL = "main";

let mainWindow: boolean | null = null;

export function isMainWindow(): boolean {
  if (mainWindow === null) {
    try {
      mainWindow = getCurrentWindow().label === MAIN_WINDOW_LABEL;
    } catch {
      mainWindow = true;
    }
  }
  return mainWindow;
}

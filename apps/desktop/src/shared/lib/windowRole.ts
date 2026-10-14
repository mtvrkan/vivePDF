import { getCurrentWindow } from "@tauri-apps/api/window";

export const MAIN_WINDOW_LABEL = "main";
export const AUDIENCE_LABEL_PREFIX = "present-";

let mainWindow: boolean | null = null;
let audienceWindow: boolean | null = null;

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

export function isAudienceLabel(label: string): boolean {
  return label.startsWith(AUDIENCE_LABEL_PREFIX);
}

export function isAudienceWindow(): boolean {
  if (audienceWindow === null) {
    try {
      audienceWindow = isAudienceLabel(getCurrentWindow().label);
    } catch {
      audienceWindow = false;
    }
  }
  return audienceWindow;
}

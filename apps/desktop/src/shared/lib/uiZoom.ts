import { getCurrentWebview } from "@tauri-apps/api/webview";
import { zoomKey } from "./shortcutKeys";

export const UI_ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export type UiZoom = (typeof UI_ZOOMS)[number];
export type UiZoomShortcut = "in" | "out" | "reset";

type ShortcutKey = { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };
export type ZoomTarget = { setZoom: (factor: number) => Promise<void> };
type ScaledRoot = { style: { fontSize: string } };

let nativeZoom: boolean | null = null;
let sequence = 0;

function alternateUiZoomShortcut(event: ShortcutKey): UiZoomShortcut | null {
  if (event.key === "+" || event.key === "=") return "in";
  if (event.key === "-") return "out";
  if (event.key === "0") return "reset";
  return null;
}

export function uiZoomShortcutFor(event: ShortcutKey): UiZoomShortcut | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  if (event.altKey) return alternateUiZoomShortcut(event);
  const zoom = zoomKey(event);
  if (zoom === "zero") return "reset";
  return zoom;
}

export function stepUiZoom(current: number, shortcut: UiZoomShortcut): UiZoom {
  if (shortcut === "reset") return 1;
  if (shortcut === "in") return UI_ZOOMS.find((zoom) => zoom > current + 0.001) ?? UI_ZOOMS[UI_ZOOMS.length - 1];
  return [...UI_ZOOMS].reverse().find((zoom) => zoom < current - 0.001) ?? UI_ZOOMS[0];
}

export function rootFontScale(uiScale: number, uiZoom: number): number {
  return Math.round(uiScale * (nativeZoom === true ? 1 : uiZoom)) / 100;
}

export function rootFontSize(uiScale: number, uiZoom: number): string {
  const percent = Math.round(uiScale * (nativeZoom === true ? 1 : uiZoom));
  return percent === 100 ? "" : `${percent}%`;
}

function currentWebview(): ZoomTarget | null {
  try {
    return getCurrentWebview();
  } catch {
    return null;
  }
}

async function applyWebviewZoom(uiZoom: number, target: ZoomTarget | null): Promise<void> {
  if (nativeZoom === false) return;
  if (!target) {
    nativeZoom = false;
    return;
  }
  try {
    await target.setZoom(uiZoom);
    nativeZoom = true;
  } catch {
    nativeZoom = false;
  }
}

export function applyInterfaceScale(root: ScaledRoot, uiScale: number, uiZoom: number, target: ZoomTarget | null = currentWebview()): Promise<void> {
  const ticket = ++sequence;
  root.style.fontSize = rootFontSize(uiScale, uiZoom);
  return applyWebviewZoom(uiZoom, target).then(() => {
    if (ticket === sequence) root.style.fontSize = rootFontSize(uiScale, uiZoom);
  });
}

export function resetUiZoomDetection(): void {
  nativeZoom = null;
}

export type ZoomShortcut = "in" | "out" | "actualSize" | "fitWidth" | "fitPage";

type ShortcutKey = { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };

export const ZOOM_MIN_LEVEL = 0.25;
export const ZOOM_MAX_LEVEL = 8;
export const ZOOM_MIN_PERCENT = ZOOM_MIN_LEVEL * 100;
export const ZOOM_MAX_PERCENT = ZOOM_MAX_LEVEL * 100;

const WHEEL_SENSITIVITY = 0.0018;
const WHEEL_MAX_STEP = 0.5;

export function zoomShortcutFor(event: ShortcutKey): ZoomShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key === "+" || event.key === "=" || event.code === "Equal" || event.code === "NumpadAdd") return "in";
  if (event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract") return "out";
  if (event.key === "0" || event.code === "Digit0" || event.code === "Numpad0") return "actualSize";
  if (event.key === "1" || event.code === "Digit1" || event.code === "Numpad1") return "fitWidth";
  if (event.key === "2" || event.code === "Digit2" || event.code === "Numpad2") return "fitPage";
  return null;
}

export function wheelZoomFactor(deltaY: number): number {
  const exponent = Math.max(-WHEEL_MAX_STEP, Math.min(WHEEL_MAX_STEP, -deltaY * WHEEL_SENSITIVITY));
  return Math.exp(exponent);
}

export function parseZoomPercent(raw: string): number | null {
  const digits = raw.replace(/[^\d.,]/g, "").replace(",", ".");
  if (!digits) return null;
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, value)));
}

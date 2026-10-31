import type { VivePdfMode, ZoomSetting } from "./types";

const MODES: readonly VivePdfMode[] = ["sized", "inline", "full", "lightbox"];

export const MIN_ZOOM_PERCENT = 10;
export const MAX_ZOOM_PERCENT = 800;

export function parseZoomSetting(value: string | number | null | undefined): ZoomSetting | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, value)) : null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "fit-width" || trimmed === "fit-page") return trimmed;
  if (!/^\d+(\.\d+)?%?$/.test(trimmed)) return null;
  return parseZoomSetting(Number.parseFloat(trimmed));
}

export function parsePageSetting(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const page = typeof value === "number" ? value : /^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN;
  return Number.isInteger(page) && page >= 1 ? page : null;
}

export function parseMode(value: string | null): VivePdfMode {
  const mode = value?.trim().toLowerCase();
  return MODES.find((entry) => entry === mode) ?? "sized";
}

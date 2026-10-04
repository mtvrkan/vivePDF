import type { StudioExportFormat } from "@/types/studio";

export const EXPORT_SETTINGS_KEY = "vivepdf.studioExport";
export const DPI_PRESETS = [72, 150, 300, 600] as const;
export const MIN_DPI = 36;
export const MAX_DPI = 600;
export const MIN_QUALITY = 10;
export const MAX_QUALITY = 100;

export type ExportSettings = {
  format: StudioExportFormat;
  dpi: number;
  quality: number;
  transparent: boolean;
  embed: boolean;
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { format: "pdf", dpi: 150, quality: 92, transparent: false, embed: true };

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function normalizeExportSettings(value: unknown): ExportSettings {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const defaults = DEFAULT_EXPORT_SETTINGS;
  return {
    format: raw.format === "png" || raw.format === "jpg" || raw.format === "pdf" ? raw.format : defaults.format,
    dpi: whole(raw.dpi, MIN_DPI, MAX_DPI, defaults.dpi),
    quality: whole(raw.quality, MIN_QUALITY, MAX_QUALITY, defaults.quality),
    transparent: typeof raw.transparent === "boolean" ? raw.transparent : defaults.transparent,
    embed: typeof raw.embed === "boolean" ? raw.embed : defaults.embed,
  };
}

export function readExportSettings(): ExportSettings {
  try {
    const stored = localStorage.getItem(EXPORT_SETTINGS_KEY);
    return normalizeExportSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

export function writeExportSettings(settings: ExportSettings): void {
  try {
    localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(normalizeExportSettings(settings)));
  } catch {
    return;
  }
}

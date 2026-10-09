import { STUDIO_PLATE_MODES, STUDIO_PRINT_SHEETS, type StudioExportFormat, type StudioPlateMode, type StudioPrintSheet } from "@/types/studio";
import { DEFAULT_BLEED_MM, MAX_BLEED_MM } from "../model/print";

export const EXPORT_SETTINGS_KEY = "vivepdf.studioExport";
export const PRINT_SETTINGS_KEY = "vivepdf.studioPrint";
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

function readStored<T>(key: string, normalize: (value: unknown) => T, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return normalize(stored ? JSON.parse(stored) : null);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function readExportSettings(): ExportSettings {
  return readStored(EXPORT_SETTINGS_KEY, normalizeExportSettings, DEFAULT_EXPORT_SETTINGS);
}

export function writeExportSettings(settings: ExportSettings): void {
  writeStored(EXPORT_SETTINGS_KEY, normalizeExportSettings(settings));
}

export type PrintSettings = { enabled: boolean; bleedMm: number; marks: boolean; plates: StudioPlateMode; sheet: StudioPrintSheet };

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { enabled: false, bleedMm: DEFAULT_BLEED_MM, marks: true, plates: "spot", sheet: "card" };

export function normalizePrintSettings(value: unknown): PrintSettings {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const defaults = DEFAULT_PRINT_SETTINGS;
  const bleed = typeof raw.bleedMm === "number" && Number.isFinite(raw.bleedMm) ? Math.round(raw.bleedMm * 2) / 2 : defaults.bleedMm;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    bleedMm: Math.min(MAX_BLEED_MM, Math.max(0, bleed)),
    marks: typeof raw.marks === "boolean" ? raw.marks : defaults.marks,
    plates: STUDIO_PLATE_MODES.find((mode) => mode === raw.plates) ?? defaults.plates,
    sheet: STUDIO_PRINT_SHEETS.find((sheet) => sheet === raw.sheet) ?? defaults.sheet,
  };
}

export function readPrintSettings(): PrintSettings {
  return readStored(PRINT_SETTINGS_KEY, normalizePrintSettings, DEFAULT_PRINT_SETTINGS);
}

export function writePrintSettings(settings: PrintSettings): void {
  writeStored(PRINT_SETTINGS_KEY, normalizePrintSettings(settings));
}

import { REDACT_PRESETS, type OutputResult, type RedactPreset, type RepairResult } from "@/types";

export type Tab = "number" | "headerFooter" | "letterhead" | "findReplace" | "crop" | "resize" | "flatten" | "redact" | "repair" | "impose" | "poster" | "bookmarks" | "autolink" | "textedit" | "cover";
export const TABS: Tab[] = ["number", "headerFooter", "letterhead", "findReplace", "crop", "resize", "flatten", "redact", "repair", "impose", "poster", "bookmarks", "autolink", "textedit", "cover"];
export const PRESETS: readonly RedactPreset[] = REDACT_PRESETS;

export function presetsFromQuery(value: string | null): RedactPreset[] {
  if (!value) return [];
  return value.split(",").filter((item): item is RedactPreset => PRESETS.includes(item as RedactPreset));
}
export const MM_TO_PT = 72 / 25.4;

export type EditRun = { tab: Tab; params: Record<string, unknown>; overwrite?: boolean; variant?: "remove" };
export type HeaderMode = "add" | "remove";
export type EditOutcome = OutputResult & { extra?: number; repair?: RepairResult; imagesKept?: number; missingGlyphs?: string; removedFurniture?: boolean };

export const NUMBER_FONT_SIZE = { min: 4, max: 72 };
export const HEADER_FONT_SIZE = { min: 4, max: 48 };
export const FURNITURE_MARGIN_MM = { min: 0, max: 60 };
export const NUMBER_START = { min: 0, max: 999999 };
export const NUMBER_PADDING = { min: 0, max: 12 };
export const NUMBER_TOKENS = ["{n}", "{page}", "{total}"];
export const TEMPLATE_PAGE = { min: 1, max: 99999 };
export const FIND_PREVIEW_LIMIT = 40;
export const CROP_INSET_MM = { min: 0, max: 500 };
export const CROP_AUTO_MARGIN_MM = { min: 0, max: 60 };
export const RESIZE_SIDE_MM = { min: 10, max: 5080 };
export const RESIZE_MARGIN_MM = { min: 0, max: 60 };

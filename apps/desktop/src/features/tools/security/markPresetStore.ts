import type { GridPosition, PageSide, WatermarkPosition } from "@/types";

const MARK_PRESET_KEY = "vivepdf.markPresets.v1";

export const GRID_POSITIONS: readonly GridPosition[] = ["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"];
export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = [...GRID_POSITIONS, "tile"];
export const PAGE_SIDES: readonly PageSide[] = ["all", "odd", "even"];
export const FLATTEN_DPIS: readonly number[] = [100, 150, 200, 300];

export type MarkPreset = { name: string; watermark?: Record<string, unknown>; stamp?: Record<string, unknown> };

export function readMarkPresets(): MarkPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MARK_PRESET_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as MarkPreset[]).filter((item) => typeof item?.name === "string" && (isRecord(item.watermark) || isRecord(item.stamp))) : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function presetNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function presetText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function presetFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function presetChoice<T extends string | number>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

export function presetColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function writeMarkPresets(items: MarkPreset[]): void {
  try {
    localStorage.setItem(MARK_PRESET_KEY, JSON.stringify(items.slice(0, 40)));
  } catch {
    return;
  }
}

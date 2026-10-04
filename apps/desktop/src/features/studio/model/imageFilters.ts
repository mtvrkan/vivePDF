import type { StudioImageFilters } from "@/types/studio";

export type FilterKey = keyof StudioImageFilters;
export type Affine = { matrix: number[][]; offset: number[] };

export const NEUTRAL_FILTERS: StudioImageFilters = { brightness: 1, contrast: 1, saturation: 1, warmth: 0, sepia: 0, grayscale: 0 };

export const FILTER_KEYS: FilterKey[] = ["brightness", "contrast", "saturation", "warmth", "sepia", "grayscale"];

export const FILTER_RANGES: Record<FilterKey, readonly [number, number]> = {
  brightness: [0, 2],
  contrast: [0, 2],
  saturation: [0, 2],
  warmth: [-1, 1],
  sepia: [0, 1],
  grayscale: [0, 1],
};

export const FILTER_PRESETS = {
  none: NEUTRAL_FILTERS,
  bw: { ...NEUTRAL_FILTERS, contrast: 1.1, grayscale: 1 },
  warm: { ...NEUTRAL_FILTERS, brightness: 1.03, saturation: 1.1, warmth: 0.6 },
  cool: { ...NEUTRAL_FILTERS, saturation: 0.95, warmth: -0.6 },
  vivid: { ...NEUTRAL_FILTERS, contrast: 1.15, saturation: 1.5 },
  fade: { ...NEUTRAL_FILTERS, brightness: 1.1, contrast: 0.75, saturation: 0.75 },
} satisfies Record<string, StudioImageFilters>;

export type FilterPreset = keyof typeof FILTER_PRESETS;

export const FILTER_PRESET_NAMES = Object.keys(FILTER_PRESETS) as FilterPreset[];

const WARMTH_GAIN = 0.15;
const DIGITS = 1e6;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clampTo(key: FilterKey, value: unknown): number {
  const [min, max] = FILTER_RANGES[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : NEUTRAL_FILTERS[key];
}

export function isNeutral(filters: StudioImageFilters | null | undefined): boolean {
  return !filters || FILTER_KEYS.every((key) => filters[key] === NEUTRAL_FILTERS[key]);
}

export function normalizeFilters(value: unknown): StudioImageFilters | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, clampTo(key, raw[key])])) as StudioImageFilters;
  return isNeutral(filters) ? undefined : filters;
}

export function presetOf(filters: StudioImageFilters | null | undefined): FilterPreset | null {
  const current = filters ?? NEUTRAL_FILTERS;
  return FILTER_PRESET_NAMES.find((name) => FILTER_KEYS.every((key) => Math.abs(FILTER_PRESETS[name][key] - current[key]) < 1e-9)) ?? null;
}

function diagonal(red: number, green: number, blue: number, offset = 0): Affine {
  return { matrix: [[red, 0, 0], [0, green, 0], [0, 0, blue]], offset: [offset, offset, offset] };
}

function saturation(amount: number): Affine {
  return {
    matrix: [
      [0.213 + 0.787 * amount, 0.715 - 0.715 * amount, 0.072 - 0.072 * amount],
      [0.213 - 0.213 * amount, 0.715 + 0.285 * amount, 0.072 - 0.072 * amount],
      [0.213 - 0.213 * amount, 0.715 - 0.715 * amount, 0.072 + 0.928 * amount],
    ],
    offset: [0, 0, 0],
  };
}

function sepia(amount: number): Affine {
  const rest = 1 - amount;
  return {
    matrix: [
      [0.393 + 0.607 * rest, 0.769 - 0.769 * rest, 0.189 - 0.189 * rest],
      [0.349 - 0.349 * rest, 0.686 + 0.314 * rest, 0.168 - 0.168 * rest],
      [0.272 - 0.272 * rest, 0.534 - 0.534 * rest, 0.131 + 0.869 * rest],
    ],
    offset: [0, 0, 0],
  };
}

function grayscale(amount: number): Affine {
  const rest = 1 - amount;
  return {
    matrix: [
      [0.2126 + 0.7874 * rest, 0.7152 - 0.7152 * rest, 0.0722 - 0.0722 * rest],
      [0.2126 - 0.2126 * rest, 0.7152 + 0.2848 * rest, 0.0722 - 0.0722 * rest],
      [0.2126 - 0.2126 * rest, 0.7152 - 0.7152 * rest, 0.0722 + 0.9278 * rest],
    ],
    offset: [0, 0, 0],
  };
}

export function compose(first: Affine, second: Affine): Affine {
  const matrix = second.matrix.map((row) => [0, 1, 2].map((column) => row.reduce((sum, value, index) => sum + value * first.matrix[index][column], 0)));
  const offset = second.matrix.map((row, rowIndex) => row.reduce((sum, value, index) => sum + value * first.offset[index], 0) + second.offset[rowIndex]);
  return { matrix, offset };
}

export function filterAffine(filters: StudioImageFilters): Affine {
  return [
    diagonal(filters.brightness, filters.brightness, filters.brightness),
    diagonal(filters.contrast, filters.contrast, filters.contrast, 0.5 - 0.5 * filters.contrast),
    saturation(filters.saturation),
    diagonal(1 + WARMTH_GAIN * filters.warmth, 1, 1 - WARMTH_GAIN * filters.warmth),
    sepia(filters.sepia),
    grayscale(filters.grayscale),
  ].reduce(compose);
}

export function filterMatrix(filters: StudioImageFilters | null | undefined): number[] | null {
  if (!filters || isNeutral(filters)) return null;
  const affine = filterAffine(filters);
  return affine.matrix.flatMap((row, index) => [...row, affine.offset[index]]).map((value) => Math.round(value * DIGITS) / DIGITS);
}

export function svgColorMatrix(matrix: readonly number[]): string {
  const rows = [0, 1, 2].map((row) => [matrix[row * 4], matrix[row * 4 + 1], matrix[row * 4 + 2], 0, matrix[row * 4 + 3]]);
  return [...rows, [0, 0, 0, 1, 0]].map((row) => row.join(" ")).join(" ");
}

export function applyMatrix(matrix: readonly number[], rgb: readonly [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((row) => {
    const value = matrix[row * 4] * rgb[0] + matrix[row * 4 + 1] * rgb[1] + matrix[row * 4 + 2] * rgb[2] + matrix[row * 4 + 3];
    return Math.min(1, Math.max(0, value));
  }) as [number, number, number];
}

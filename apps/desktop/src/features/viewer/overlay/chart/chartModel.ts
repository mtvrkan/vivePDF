import type { ChartSpec, ChartType } from "@/types";
import { applyGridEdit, resizeColumnList, type GridEdit, type GridLimits } from "../grid/gridModel";

export const CHART_TYPES: readonly ChartType[] = ["column", "bar", "line", "area", "pie", "doughnut", "scatter", "histogram", "box", "dotplot"];
export const SAMPLE_TYPES: readonly ChartType[] = ["histogram", "box", "dotplot"];
export const CHART_BINS = { auto: 0, max: 30 } as const;
export const STACKABLE_TYPES: readonly ChartType[] = ["column", "bar", "area"];
export const ROUND_TYPES: readonly ChartType[] = ["pie", "doughnut"];
export const CHART_LIMITS: GridLimits = { rows: 101, columns: 9, cellChars: 200, minColumns: 2 };
export const DEFAULT_CHART_FONT = "bundled:dejavu-sans";

export const CHART_PALETTES = {
  vivid: ["#2563eb", "#f97316", "#16a34a", "#dc2626", "#9333ea", "#0891b2", "#ca8a04", "#db2777"],
  ocean: ["#0369a1", "#14b8a6", "#1e3a8a", "#38bdf8", "#0e7490", "#5eead4", "#0c4a6e", "#0284c7"],
  sunset: ["#c2410c", "#fbbf24", "#be185d", "#f97316", "#7c2d12", "#fb923c", "#e11d48", "#9f1239"],
  forest: ["#15803d", "#a16207", "#84cc16", "#14532d", "#65a30d", "#22c55e", "#4d7c0f", "#166534"],
  pastel: ["#93c5fd", "#fdba74", "#86efac", "#fca5a5", "#c4b5fd", "#67e8f9", "#fde68a", "#f9a8d4"],
  grey: ["#1f2937", "#6b7280", "#9ca3af", "#374151", "#d1d5db", "#4b5563", "#111827", "#e5e7eb"],
} as const;

export type ChartPaletteId = keyof typeof CHART_PALETTES;
export const CHART_PALETTE_IDS = Object.keys(CHART_PALETTES) as ChartPaletteId[];

export type ChartSettings = {
  type: ChartType;
  cells: string[][];
  colors: string[];
  palette: ChartPaletteId;
  title: string;
  categoryTitle: string;
  valueTitle: string;
  legend: boolean;
  grid: boolean;
  valueLabels: boolean;
  stacked: boolean;
  width: number;
  height: number;
  fontSize: number;
  fontId: string;
  color: string;
  decimal: "." | ",";
  bins: number;
};

export type ChartLook = Omit<ChartSettings, "cells" | "colors" | "title" | "categoryTitle" | "valueTitle">;

export type ChartData = { spec: ChartSpec; invalid: Set<string>; blank: boolean };

export const DEFAULT_CHART_LOOK: ChartLook = {
  type: "column",
  palette: "vivid",
  legend: true,
  grid: true,
  valueLabels: false,
  stacked: false,
  width: 360,
  height: 240,
  fontSize: 10,
  fontId: DEFAULT_CHART_FONT,
  color: "#1f2937",
  decimal: ".",
  bins: CHART_BINS.auto,
};

export function paletteColor(palette: ChartPaletteId, index: number): string {
  const colors = CHART_PALETTES[palette];
  return colors[index % colors.length];
}

export function sampleCells(seriesName: (number: number) => string, categoryName: (number: number) => string): string[][] {
  return [
    ["", seriesName(1), seriesName(2)],
    [categoryName(1), "4", "2"],
    [categoryName(2), "6", "3"],
    [categoryName(3), "5", "4"],
    [categoryName(4), "8", "5"],
  ];
}

export function newChart(look: ChartLook, cells: string[][]): ChartSettings {
  return { ...look, cells, colors: cells[0].slice(1).map((_, index) => paletteColor(look.palette, index)), title: "", categoryTitle: "", valueTitle: "" };
}

export function chartLook(settings: ChartSettings): ChartLook {
  const { type, palette, legend, grid, valueLabels, stacked, width, height, fontSize, fontId, color, decimal, bins } = settings;
  return { type, palette, legend, grid, valueLabels, stacked, width, height, fontSize, fontId, color, decimal, bins };
}

export function decimalOf(locale: string): "." | "," {
  const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((entry) => entry.type === "decimal");
  return part?.value === "," ? "," : ".";
}

export function parseChartNumber(text: string): number | null {
  let cleaned = text.split(/\s+/).join("").replace(/−/g, "-");
  if (!cleaned) return null;
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const separator = comma > dot ? "," : ".";
    const grouping = separator === "," ? "." : ",";
    cleaned = cleaned.split(grouping).join("").replace(separator, ".");
  } else if (comma >= 0) {
    cleaned = cleaned.split(",").length === 2 ? cleaned.replace(",", ".") : cleaned.split(",").join("");
  } else if (cleaned.split(".").length > 2) {
    cleaned = cleaned.split(".").join("");
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function applyChartEdit(settings: ChartSettings, edit: GridEdit): ChartSettings {
  const cells = applyGridEdit(settings.cells, edit, CHART_LIMITS);
  if (cells === settings.cells) return settings;
  return { ...settings, cells, colors: resizeColumnList(settings.colors, cells, edit, (index) => paletteColor(settings.palette, index), 1) };
}

export function setSeriesColor(settings: ChartSettings, series: number, color: string): ChartSettings {
  return { ...settings, colors: settings.colors.map((value, index) => (index === series ? color : value)) };
}

export function applyPalette(settings: ChartSettings, palette: ChartPaletteId): ChartSettings {
  return { ...settings, palette, colors: settings.colors.map((_, index) => paletteColor(palette, index)) };
}

export function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function chartData(settings: ChartSettings): ChartData {
  const invalid = new Set<string>();
  const [header = [], ...body] = settings.cells;
  const rows = body.map((row, index) => ({ row, number: index + 1 })).filter(({ row }) => row.some((text) => text.trim() !== ""));
  const columns = header.map((_, column) => column).filter((column) => column > 0 && (header[column].trim() !== "" || rows.some(({ row }) => (row[column] ?? "").trim() !== "")));
  const series = columns.map((column) => ({
    name: header[column].trim(),
    color: settings.colors[column - 1] ?? paletteColor(settings.palette, column - 1),
    values: rows.map(({ row, number }) => {
      const text = (row[column] ?? "").trim();
      if (!text) return null;
      const value = parseChartNumber(text);
      if (value === null) invalid.add(cellKey(number, column));
      return value;
    }),
  }));
  if (settings.type === "scatter") {
    for (const { row, number } of rows) if (parseChartNumber(row[0]) === null) invalid.add(cellKey(number, 0));
  }
  const blank = rows.length === 0 || series.length === 0 || series.every((entry) => entry.values.every((value) => value === null));
  const spec: ChartSpec = {
    type: settings.type,
    categories: rows.map(({ row }) => row[0].trim()),
    series,
    title: settings.title.trim(),
    categoryTitle: settings.categoryTitle.trim(),
    valueTitle: settings.valueTitle.trim(),
    legend: settings.legend,
    grid: settings.grid,
    valueLabels: settings.valueLabels,
    stacked: settings.stacked && STACKABLE_TYPES.includes(settings.type),
    width: settings.width,
    height: settings.height,
    fontSize: settings.fontSize,
    fontId: settings.fontId,
    color: settings.color,
    palette: [...CHART_PALETTES[settings.palette]],
    decimal: settings.decimal,
    bins: settings.type === "histogram" && settings.bins > CHART_BINS.auto ? settings.bins : null,
  };
  return { spec, invalid, blank };
}

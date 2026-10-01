import type { TableAlign, TableBorder, TableSpec } from "@/types";
import { applyGridEdit, emptyCells, gridColumns, resizeColumnList, type GridEdit, type GridLimits } from "../grid/gridModel";

export const TABLE_LIMITS: GridLimits = { rows: 60, columns: 20, cellChars: 2000, minColumns: 1 };
export const TABLE_BORDERS: readonly TableBorder[] = ["all", "horizontal", "outer", "none"];
export const TABLE_ALIGNS: readonly TableAlign[] = ["left", "center", "right"];
export const TABLE_WIDTH_MODES = ["equal", "fit"] as const;
export const DEFAULT_TABLE_FONT = "bundled:dejavu-sans";

export type TableWidthMode = (typeof TABLE_WIDTH_MODES)[number];

export type TableSettings = {
  cells: string[][];
  align: TableAlign[];
  widthMode: TableWidthMode;
  width: number;
  fontSize: number;
  fontId: string;
  header: boolean;
  border: TableBorder;
  color: string;
  borderColor: string;
  headerFill: string | null;
  stripes: boolean;
};

export type TableLook = Omit<TableSettings, "cells" | "align">;

export type TableStyle = { id: string; border: TableBorder; color: string; borderColor: string; headerFill: string | null; stripes: boolean };

export const TABLE_STYLES: readonly TableStyle[] = [
  { id: "classic", border: "all", color: "#111111", borderColor: "#404040", headerFill: "#e5e7eb", stripes: false },
  { id: "blue", border: "all", color: "#0f172a", borderColor: "#1e3a8a", headerFill: "#bfdbfe", stripes: true },
  { id: "green", border: "horizontal", color: "#052e16", borderColor: "#166534", headerFill: "#bbf7d0", stripes: true },
  { id: "warm", border: "outer", color: "#1c1917", borderColor: "#9a3412", headerFill: "#fed7aa", stripes: true },
  { id: "minimal", border: "horizontal", color: "#111111", borderColor: "#9ca3af", headerFill: null, stripes: false },
  { id: "plain", border: "none", color: "#111111", borderColor: "#111111", headerFill: null, stripes: false },
];

export const DEFAULT_TABLE: TableSettings = {
  cells: emptyCells(4, 3),
  align: ["left", "left", "left"],
  widthMode: "equal",
  width: 400,
  fontSize: 11,
  fontId: DEFAULT_TABLE_FONT,
  header: true,
  border: "all",
  color: "#111111",
  borderColor: "#404040",
  headerFill: "#e5e7eb",
  stripes: false,
};

export function tableLook(settings: TableSettings): TableLook {
  const { widthMode, width, fontSize, fontId, header, border, color, borderColor, headerFill, stripes } = settings;
  return { widthMode, width, fontSize, fontId, header, border, color, borderColor, headerFill, stripes };
}

export function freshTable(look: TableLook): TableSettings {
  return { ...look, cells: emptyCells(DEFAULT_TABLE.cells.length, DEFAULT_TABLE.align.length), align: [...DEFAULT_TABLE.align] };
}

export function columnCount(settings: TableSettings): number {
  return gridColumns(settings.cells);
}

export function applyTableEdit(settings: TableSettings, edit: GridEdit): TableSettings {
  const cells = applyGridEdit(settings.cells, edit, TABLE_LIMITS);
  if (cells === settings.cells) return settings;
  return { ...settings, cells, align: resizeColumnList(settings.align, cells, edit, () => "left") };
}

export function applyStyle(settings: TableSettings, style: TableStyle): TableSettings {
  const { border, color, borderColor, headerFill, stripes } = style;
  return { ...settings, border, color, borderColor, headerFill, stripes };
}

export function matchingStyle(settings: TableSettings): string | null {
  const found = TABLE_STYLES.find((style) => style.border === settings.border && style.color === settings.color && style.borderColor === settings.borderColor && style.headerFill === settings.headerFill && style.stripes === settings.stripes);
  return found?.id ?? null;
}

export function setAlign(settings: TableSettings, column: number, align: TableAlign): TableSettings {
  return { ...settings, align: settings.align.map((value, index) => (index === column ? align : value)) };
}

export function isBlankTable(settings: TableSettings): boolean {
  return settings.cells.every((cells) => cells.every((text) => text.trim() === ""));
}

export function columnWeights(settings: TableSettings): number[] {
  if (settings.widthMode === "equal") return settings.align.map(() => 1);
  return settings.align.map((_, column) => {
    const longest = Math.max(0, ...settings.cells.flatMap((cells) => (cells[column] ?? "").split("\n").map((line) => line.trim().length)));
    return Math.min(40, Math.max(3, longest));
  });
}

export function toTableSpec(settings: TableSettings): TableSpec {
  return {
    cells: settings.cells,
    columnWidths: columnWeights(settings),
    align: settings.align,
    width: settings.width,
    fontSize: settings.fontSize,
    fontId: settings.fontId,
    header: settings.header,
    border: settings.border,
    color: settings.color,
    borderColor: settings.borderColor,
    headerFill: settings.headerFill,
    stripes: settings.stripes,
  };
}

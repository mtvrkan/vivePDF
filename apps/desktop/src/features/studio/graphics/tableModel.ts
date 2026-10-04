import type { TableAlign, TableBorder, TableCellStyle } from "@/types";

export const TABLE_LIMITS = { rows: 60, columns: 20, cellChars: 2000 } as const;
export const TABLE_ALIGNS: readonly TableAlign[] = ["left", "center", "right"];
export const TABLE_BORDERS: readonly TableBorder[] = ["all", "horizontal", "outer", "none"];
export const MIN_COLUMN_WIDTH = 12;
export const MIN_TABLE_FONT = 4;
export const MAX_TABLE_FONT = 72;
export const MAX_BORDER_WIDTH = 20;
export const DEFAULT_TABLE_FONT_ID = "bundled:dejavu-sans";

export type CellRef = { row: number; column: number };
export type CellRange = { anchor: CellRef; focus: CellRef };
export type CellMove = "next" | "previous" | "up" | "down" | "left" | "right";
export type TableLayout = { width: number; height: number; rows: number[]; columns: number[] };

export type StudioTableData = {
  kind: "table";
  cells: string[][];
  styles: TableCellStyle[][];
  columns: number[];
  align: TableAlign[];
  header: boolean;
  stripes: boolean;
  stripeFill: string | null;
  border: TableBorder;
  borderColor: string;
  borderWidth: number;
  color: string;
  headerFill: string | null;
  fontSize: number;
  fontId: string;
  rendered: string;
  layout: TableLayout | null;
};

export type TableLook = Pick<StudioTableData, "header" | "stripes" | "stripeFill" | "border" | "borderColor" | "borderWidth" | "color" | "headerFill">;

export type TableStyleId = "classic" | "blue" | "green" | "warm" | "minimal" | "plain";

export const TABLE_STYLES: Record<TableStyleId, TableLook> = {
  classic: { header: true, stripes: false, stripeFill: null, border: "all", borderColor: "#404040", borderWidth: 0.75, color: "#111111", headerFill: "#e5e7eb" },
  blue: { header: true, stripes: true, stripeFill: "#eff6ff", border: "all", borderColor: "#1e3a8a", borderWidth: 0.75, color: "#0f172a", headerFill: "#bfdbfe" },
  green: { header: true, stripes: true, stripeFill: "#f0fdf4", border: "horizontal", borderColor: "#166534", borderWidth: 0.75, color: "#052e16", headerFill: "#bbf7d0" },
  warm: { header: true, stripes: true, stripeFill: "#fff7ed", border: "outer", borderColor: "#9a3412", borderWidth: 1, color: "#1c1917", headerFill: "#fed7aa" },
  minimal: { header: true, stripes: false, stripeFill: null, border: "horizontal", borderColor: "#9ca3af", borderWidth: 0.5, color: "#111111", headerFill: null },
  plain: { header: false, stripes: false, stripeFill: null, border: "none", borderColor: "#111111", borderWidth: 0.75, color: "#111111", headerFill: null },
};

export const TABLE_STYLE_IDS = Object.keys(TABLE_STYLES) as TableStyleId[];

const COLOUR = /^#[0-9a-f]{6}$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function blankRow(columns: number): string[] {
  return Array.from({ length: columns }, () => "");
}

function blankStyles(columns: number): TableCellStyle[] {
  return Array.from({ length: columns }, () => ({}));
}

function evenColumns(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function normalizeColumns(columns: number[]): number[] {
  const safe = columns.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = sum(safe);
  if (total <= 0) return evenColumns(columns.length);
  const floor = 1 / columns.length / 4;
  const scaled = safe.map((value) => (value > 0 ? value / total : floor));
  const scaledTotal = sum(scaled);
  return scaled.map((value) => value / scaledTotal);
}

export function columnCount(data: Pick<StudioTableData, "cells">): number {
  return data.cells[0]?.length ?? 0;
}

export function createTableData(rows: number, columns: number, look: TableLook = TABLE_STYLES.classic, fontSize = 12, fontId = DEFAULT_TABLE_FONT_ID): StudioTableData {
  const rowCount = clamp(Math.round(rows), 1, TABLE_LIMITS.rows);
  const columnTotal = clamp(Math.round(columns), 1, TABLE_LIMITS.columns);
  return {
    kind: "table",
    cells: Array.from({ length: rowCount }, () => blankRow(columnTotal)),
    styles: Array.from({ length: rowCount }, () => blankStyles(columnTotal)),
    columns: evenColumns(columnTotal),
    align: Array.from({ length: columnTotal }, () => "left"),
    ...look,
    fontSize,
    fontId,
    rendered: "",
    layout: null,
  };
}

function withShape(data: StudioTableData, cells: string[][], styles: TableCellStyle[][], columns: number[], align: TableAlign[]): StudioTableData {
  return { ...data, cells, styles, columns: normalizeColumns(columns), align };
}

export function setCellText(data: StudioTableData, cell: CellRef, text: string): StudioTableData {
  if (data.cells[cell.row]?.[cell.column] === undefined) return data;
  const value = text.slice(0, TABLE_LIMITS.cellChars);
  if (data.cells[cell.row][cell.column] === value) return data;
  return { ...data, cells: data.cells.map((row, index) => (index === cell.row ? row.map((item, column) => (column === cell.column ? value : item)) : row)) };
}

export function insertRow(data: StudioTableData, at: number): StudioTableData {
  if (data.cells.length >= TABLE_LIMITS.rows) return data;
  const index = clamp(at, 0, data.cells.length);
  const columns = columnCount(data);
  const cells = [...data.cells];
  const styles = [...data.styles];
  const source = index > 0 ? index - 1 : 0;
  const template = data.header && source === 0 ? null : data.styles[source];
  cells.splice(index, 0, blankRow(columns));
  styles.splice(index, 0, template ? template.map((style) => ({ ...style })) : blankStyles(columns));
  return { ...data, cells, styles };
}

export function removeRow(data: StudioTableData, row: number): StudioTableData {
  if (data.cells.length <= 1 || row < 0 || row >= data.cells.length) return data;
  return { ...data, cells: data.cells.filter((_, index) => index !== row), styles: data.styles.filter((_, index) => index !== row) };
}

export function insertColumn(data: StudioTableData, at: number): StudioTableData {
  const columns = columnCount(data);
  if (columns >= TABLE_LIMITS.columns) return data;
  const index = clamp(at, 0, columns);
  const width = 1 / columns;
  const source = Math.min(index, columns - 1);
  const nextColumns = [...data.columns];
  nextColumns.splice(index, 0, width);
  const align = [...data.align];
  align.splice(index, 0, data.align[source] ?? "left");
  return withShape(
    data,
    data.cells.map((row) => [...row.slice(0, index), "", ...row.slice(index)]),
    data.styles.map((row) => [...row.slice(0, index), { ...(row[source] ?? {}) }, ...row.slice(index)]),
    nextColumns,
    align,
  );
}

export function removeColumn(data: StudioTableData, column: number): StudioTableData {
  const columns = columnCount(data);
  if (columns <= 1 || column < 0 || column >= columns) return data;
  const keep = (_: unknown, index: number) => index !== column;
  return withShape(
    data,
    data.cells.map((row) => row.filter(keep)),
    data.styles.map((row) => row.filter(keep)),
    data.columns.filter(keep),
    data.align.filter(keep),
  );
}

export function moveColumnBorder(data: StudioTableData, border: number, delta: number, tableWidth: number): StudioTableData {
  if (border < 0 || border >= data.columns.length - 1 || tableWidth <= 0) return data;
  const widths = data.columns.map((fraction) => fraction * tableWidth);
  const pair = widths[border] + widths[border + 1];
  const minimum = Math.min(MIN_COLUMN_WIDTH, pair / 2);
  const left = clamp(widths[border] + delta, minimum, pair - minimum);
  widths[border] = left;
  widths[border + 1] = pair - left;
  return { ...data, columns: normalizeColumns(widths) };
}

export function setColumnWidth(data: StudioTableData, column: number, width: number, tableWidth: number): { data: StudioTableData; width: number } {
  if (column < 0 || column >= data.columns.length || tableWidth <= 0) return { data, width: tableWidth };
  const widths = data.columns.map((fraction) => fraction * tableWidth);
  widths[column] = Math.max(MIN_COLUMN_WIDTH, width);
  const total = sum(widths);
  return { data: { ...data, columns: normalizeColumns(widths) }, width: total };
}

export function distributeColumns(data: StudioTableData): StudioTableData {
  return { ...data, columns: evenColumns(data.columns.length) };
}

export function pasteGrid(data: StudioTableData, at: CellRef, grid: string[][]): StudioTableData {
  const wide = Math.max(0, ...grid.map((row) => row.length));
  let next = data;
  while (next.cells.length < Math.min(TABLE_LIMITS.rows, at.row + grid.length)) next = insertRow(next, next.cells.length);
  while (columnCount(next) < Math.min(TABLE_LIMITS.columns, at.column + wide)) next = insertColumn(next, columnCount(next));
  const cells = next.cells.map((row, rowIndex) =>
    row.map((text, columnIndex) => {
      const pasted = grid[rowIndex - at.row]?.[columnIndex - at.column];
      return pasted === undefined ? text : pasted.slice(0, TABLE_LIMITS.cellChars);
    }),
  );
  return { ...next, cells };
}

export function rangeBounds(range: CellRange): { top: number; bottom: number; left: number; right: number } {
  return {
    top: Math.min(range.anchor.row, range.focus.row),
    bottom: Math.max(range.anchor.row, range.focus.row),
    left: Math.min(range.anchor.column, range.focus.column),
    right: Math.max(range.anchor.column, range.focus.column),
  };
}

export function inRange(range: CellRange, cell: CellRef): boolean {
  const box = rangeBounds(range);
  return cell.row >= box.top && cell.row <= box.bottom && cell.column >= box.left && cell.column <= box.right;
}

export function clampRange(data: StudioTableData, range: CellRange): CellRange {
  const last = { row: data.cells.length - 1, column: columnCount(data) - 1 };
  const fit = (cell: CellRef) => ({ row: clamp(cell.row, 0, last.row), column: clamp(cell.column, 0, last.column) });
  return { anchor: fit(range.anchor), focus: fit(range.focus) };
}

export function styleRange(data: StudioTableData, range: CellRange, patch: { [K in keyof TableCellStyle]?: TableCellStyle[K] | null }): StudioTableData {
  const styles = data.styles.map((row, rowIndex) =>
    row.map((style, column) => {
      if (!inRange(range, { row: rowIndex, column })) return style;
      const next: TableCellStyle = { ...style };
      for (const [key, value] of Object.entries(patch) as [keyof TableCellStyle, TableCellStyle[keyof TableCellStyle] | null][]) {
        if (value === null || value === undefined) delete next[key];
        else (next as Record<string, unknown>)[key] = value;
      }
      return next;
    }),
  );
  return { ...data, styles };
}

export function rangeStyle(data: StudioTableData, range: CellRange): TableCellStyle {
  const box = rangeBounds(range);
  return data.styles[box.top]?.[box.left] ?? {};
}

export function cellAlign(data: StudioTableData, cell: CellRef): TableAlign {
  return data.styles[cell.row]?.[cell.column]?.align ?? data.align[cell.column] ?? "left";
}

export function cellBold(data: StudioTableData, cell: CellRef): boolean {
  return data.styles[cell.row]?.[cell.column]?.bold ?? (data.header && cell.row === 0);
}

export function cellFill(data: StudioTableData, cell: CellRef): string | null {
  const own = data.styles[cell.row]?.[cell.column]?.fill;
  if (own) return own;
  if (data.header && cell.row === 0) return data.headerFill;
  if (data.stripes && (cell.row - (data.header ? 1 : 0)) % 2 === 1) return data.stripeFill;
  return null;
}

export function cellColor(data: StudioTableData, cell: CellRef): string {
  return data.styles[cell.row]?.[cell.column]?.color ?? data.color;
}

export function neighbour(data: StudioTableData, cell: CellRef, move: CellMove): CellRef | null {
  const rows = data.cells.length;
  const columns = columnCount(data);
  switch (move) {
    case "next":
      if (cell.column + 1 < columns) return { row: cell.row, column: cell.column + 1 };
      return cell.row + 1 < rows ? { row: cell.row + 1, column: 0 } : null;
    case "previous":
      if (cell.column > 0) return { row: cell.row, column: cell.column - 1 };
      return cell.row > 0 ? { row: cell.row - 1, column: columns - 1 } : null;
    case "up":
      return cell.row > 0 ? { row: cell.row - 1, column: cell.column } : null;
    case "down":
      return cell.row + 1 < rows ? { row: cell.row + 1, column: cell.column } : null;
    case "left":
      return cell.column > 0 ? { row: cell.row, column: cell.column - 1 } : null;
    case "right":
      return cell.column + 1 < columns ? { row: cell.row, column: cell.column + 1 } : null;
  }
}

export function tableTexts(data: StudioTableData): string[] {
  return data.cells.flat();
}

function edges(sizes: number[]): number[] {
  const result = [0];
  for (const value of sizes) result.push(result[result.length - 1] + value);
  return result;
}

export function tableGeometry(data: StudioTableData, width: number, height: number): { columns: number[]; rows: number[] } {
  const columns = edges(data.columns.map((fraction) => fraction * width));
  const layout = data.layout;
  if (layout && layout.rows.length === data.cells.length && layout.height > 0) {
    const scale = height / layout.height;
    return { columns, rows: edges(layout.rows.map((row) => row * scale)) };
  }
  return { columns, rows: edges(data.cells.map(() => height / data.cells.length)) };
}

export function clearRange(data: StudioTableData, range: CellRange): StudioTableData {
  return { ...data, cells: data.cells.map((row, rowIndex) => row.map((text, column) => (inRange(range, { row: rowIndex, column }) ? "" : text))) };
}

export function rangeSize(range: CellRange): number {
  const box = rangeBounds(range);
  return (box.bottom - box.top + 1) * (box.right - box.left + 1);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function colourOr<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === "string" && COLOUR.test(value) ? value.toLowerCase() : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function normalizeStyle(value: unknown): TableCellStyle {
  const raw = record(value);
  if (!raw) return {};
  const style: TableCellStyle = {};
  if (typeof raw.fill === "string" && COLOUR.test(raw.fill)) style.fill = raw.fill.toLowerCase();
  if (typeof raw.color === "string" && COLOUR.test(raw.color)) style.color = raw.color.toLowerCase();
  if (TABLE_ALIGNS.includes(raw.align as TableAlign)) style.align = raw.align as TableAlign;
  if (typeof raw.bold === "boolean") style.bold = raw.bold;
  return style;
}

function normalizeLayout(value: unknown, rows: number, columns: number): TableLayout | null {
  const raw = record(value);
  if (!raw) return null;
  const list = (items: unknown, length: number) => (Array.isArray(items) && items.length === length && items.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0) ? (items as number[]) : null);
  const rowHeights = list(raw.rows, rows);
  const columnWidths = list(raw.columns, columns);
  const width = number(raw.width, 0, 0, 100000);
  const height = number(raw.height, 0, 0, 100000);
  if (!rowHeights || !columnWidths || width <= 0 || height <= 0) return null;
  return { width, height, rows: rowHeights, columns: columnWidths };
}

export function normalizeTableData(value: unknown): StudioTableData | null {
  const raw = record(value);
  if (!raw || raw.kind !== "table" || !Array.isArray(raw.cells) || !raw.cells.length) return null;
  const rows = raw.cells.slice(0, TABLE_LIMITS.rows).map((row) => (Array.isArray(row) ? row.slice(0, TABLE_LIMITS.columns).map((text) => (typeof text === "string" ? text.slice(0, TABLE_LIMITS.cellChars) : "")) : []));
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const cells = rows.map((row) => [...row, ...blankRow(columns - row.length)]);
  const rawStyles = Array.isArray(raw.styles) ? raw.styles : [];
  const styles = cells.map((_, rowIndex) => {
    const row = Array.isArray(rawStyles[rowIndex]) ? (rawStyles[rowIndex] as unknown[]) : [];
    return Array.from({ length: columns }, (_, column) => normalizeStyle(row[column]));
  });
  const rawColumns = Array.isArray(raw.columns) ? raw.columns : [];
  const rawAlign = Array.isArray(raw.align) ? raw.align : [];
  const look = TABLE_STYLES.classic;
  return {
    kind: "table",
    cells,
    styles,
    columns: normalizeColumns(Array.from({ length: columns }, (_, index) => (typeof rawColumns[index] === "number" ? (rawColumns[index] as number) : 0))),
    align: Array.from({ length: columns }, (_, index) => oneOf(rawAlign[index], TABLE_ALIGNS, "left")),
    header: typeof raw.header === "boolean" ? raw.header : look.header,
    stripes: typeof raw.stripes === "boolean" ? raw.stripes : look.stripes,
    stripeFill: colourOr(raw.stripeFill, null),
    border: oneOf(raw.border, TABLE_BORDERS, look.border),
    borderColor: colourOr(raw.borderColor, look.borderColor),
    borderWidth: number(raw.borderWidth, look.borderWidth, 0.1, MAX_BORDER_WIDTH),
    color: colourOr(raw.color, look.color),
    headerFill: colourOr(raw.headerFill, null),
    fontSize: number(raw.fontSize, 12, MIN_TABLE_FONT, MAX_TABLE_FONT * 20),
    fontId: typeof raw.fontId === "string" && raw.fontId ? raw.fontId.slice(0, 1024) : DEFAULT_TABLE_FONT_ID,
    rendered: typeof raw.rendered === "string" ? raw.rendered.slice(0, 64) : "",
    layout: normalizeLayout(raw.layout, cells.length, columns),
  };
}

export function matchingTableStyle(data: StudioTableData): TableStyleId | null {
  return TABLE_STYLE_IDS.find((id) => {
    const look = TABLE_STYLES[id];
    return (Object.keys(look) as (keyof TableLook)[]).every((key) => look[key] === data[key]);
  }) ?? null;
}

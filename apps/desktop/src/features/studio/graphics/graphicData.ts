import { CHART_PALETTE_IDS, CHART_TYPES, DEFAULT_CHART_LOOK, LEGEND_POSITIONS, chartData, type ChartPaletteId, type ChartSettings } from "@/features/viewer/overlay/chart/chartModel";
import { DEFAULT_FLOW_LOOK, FLOW_DIRECTIONS, FLOW_LIMITS, FLOW_SHAPES, isBlankFlowchart, toFlowchartSpec, type FlowchartSettings } from "@/features/viewer/overlay/flowchart/flowchartModel";
import { coloredFormulaSvg, type FormulaSource } from "@/features/viewer/overlay/formula/formulaSvg";
import type { ChartSpec, FlowchartSpec, TableSpec } from "@/types";
import type { StudioElement, StudioGraphicSpec, StudioSvgElement } from "@/types/studio";
import { MAX_BORDER_WIDTH, MAX_TABLE_FONT, MIN_TABLE_FONT, normalizeTableData, type StudioTableData, type TableLayout } from "./tableModel";

export type GraphicSize = { width: number; height: number };
export type StudioChartData = { kind: "chart"; settings: ChartSettings; rendered: string };
export type StudioFlowchartData = { kind: "flowchart"; settings: FlowchartSettings; rendered: string; layout: GraphicSize | null };
export type StudioFormulaData = { kind: "formula"; formula: FormulaSource };

export type StudioGraphic =
  | { kind: "table"; data: StudioTableData }
  | { kind: "chart"; data: StudioChartData }
  | { kind: "flowchart"; data: StudioFlowchartData }
  | { kind: "formula"; data: StudioFormulaData };

export type GraphicKind = StudioGraphic["kind"];
export type RenderedGraphic = { svg: string; width: number; height: number; rowHeights?: number[]; columnWidths?: number[] };
export type GraphicJob = { id: string; key: string; graphic: StudioGraphicSpec };

const TABLE_FRAME = { min: 40, max: 2000 };
const CHART_FRAME = { minWidth: 120, maxWidth: 1200, minHeight: 80, maxHeight: 1200, minFont: 4, maxFont: 36 };
const MIN_BORDER = 0.05;
const COLOUR = /^#[0-9a-f]{6}$/i;
const SVG_ROOT = /<svg\b[^>]*>/;

const cache = new WeakMap<object, StudioGraphic | null>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function colour(value: unknown, fallback: string): string {
  return typeof value === "string" && COLOUR.test(value) ? value.toLowerCase() : fallback;
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function size(value: unknown): GraphicSize | null {
  const raw = record(value);
  if (!raw) return null;
  const width = finite(raw.width, 0, 0, 100000);
  const height = finite(raw.height, 0, 0, 100000);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function normalizeChartSettings(value: unknown): ChartSettings | null {
  const raw = record(value);
  if (!raw || !Array.isArray(raw.cells) || !raw.cells.length) return null;
  const rows = raw.cells.slice(0, 101).map((row) => (Array.isArray(row) ? row.slice(0, 9).map((cell) => text(cell, 200)) : []));
  const columns = Math.max(2, ...rows.map((row) => row.length));
  const cells = rows.map((row) => [...row, ...Array.from({ length: columns - row.length }, () => "")]);
  const palette = oneOf(raw.palette, CHART_PALETTE_IDS, DEFAULT_CHART_LOOK.palette) as ChartPaletteId;
  const rawColors = Array.isArray(raw.colors) ? raw.colors : [];
  const fallback = DEFAULT_CHART_LOOK;
  return {
    type: oneOf(raw.type, CHART_TYPES, fallback.type),
    cells,
    colors: Array.from({ length: columns - 1 }, (_, index) => colour(rawColors[index], "#2563eb")),
    palette,
    title: text(raw.title, 300),
    categoryTitle: text(raw.categoryTitle, 200),
    valueTitle: text(raw.valueTitle, 200),
    legend: typeof raw.legend === "boolean" ? raw.legend : fallback.legend,
    legendPosition: oneOf(raw.legendPosition, LEGEND_POSITIONS, fallback.legendPosition),
    grid: typeof raw.grid === "boolean" ? raw.grid : fallback.grid,
    valueLabels: typeof raw.valueLabels === "boolean" ? raw.valueLabels : fallback.valueLabels,
    stacked: typeof raw.stacked === "boolean" ? raw.stacked : fallback.stacked,
    width: finite(raw.width, fallback.width, 1, 100000),
    height: finite(raw.height, fallback.height, 1, 100000),
    fontSize: finite(raw.fontSize, fallback.fontSize, 1, 1000),
    fontId: typeof raw.fontId === "string" && raw.fontId ? raw.fontId.slice(0, 1024) : fallback.fontId,
    color: colour(raw.color, fallback.color),
    decimal: raw.decimal === "," ? "," : ".",
    bins: finite(raw.bins, fallback.bins, 0, 30),
  };
}

export function normalizeFlowchartSettings(value: unknown): FlowchartSettings | null {
  const raw = record(value);
  if (!raw || !Array.isArray(raw.nodes) || !raw.nodes.length) return null;
  const nodes = raw.nodes
    .slice(0, FLOW_LIMITS.nodes)
    .map(record)
    .filter((node): node is Record<string, unknown> => node !== null && typeof node.id === "string" && node.id.length > 0 && node.id.length <= 40)
    .map((node) => ({ id: node.id as string, shape: oneOf(node.shape, FLOW_SHAPES, "process"), text: text(node.text, FLOW_LIMITS.nodeChars) }));
  if (!nodes.length) return null;
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .slice(0, FLOW_LIMITS.edges)
    .map(record)
    .filter((edge): edge is Record<string, unknown> => edge !== null && typeof edge.source === "string" && typeof edge.target === "string")
    .map((edge) => ({ source: edge.source as string, target: edge.target as string, label: text(edge.label, FLOW_LIMITS.labelChars) }));
  const look = DEFAULT_FLOW_LOOK;
  return {
    nodes,
    edges,
    direction: oneOf(raw.direction, FLOW_DIRECTIONS, look.direction),
    fontSize: finite(raw.fontSize, look.fontSize, 4, 36),
    fontId: typeof raw.fontId === "string" && raw.fontId ? raw.fontId.slice(0, 1024) : look.fontId,
    color: colour(raw.color, look.color),
    stroke: colour(raw.stroke, look.stroke),
    fill: raw.fill === null ? null : colour(raw.fill, look.fill ?? "#eef2ff"),
  };
}

function normalizeFormula(value: unknown): FormulaSource | null {
  const raw = record(value);
  if (!raw || typeof raw.latex !== "string" || typeof raw.svg !== "string" || !raw.svg.startsWith("<svg")) return null;
  const emWidth = finite(raw.emWidth, 0, 0, 100000);
  const emHeight = finite(raw.emHeight, 0, 0, 100000);
  if (emWidth <= 0 || emHeight <= 0) return null;
  return { latex: raw.latex.slice(0, 20000), svg: raw.svg, color: colour(raw.color, "#111111"), emWidth, emHeight };
}

function readGraphic(element: StudioSvgElement): StudioGraphic | null {
  const raw = record(element.data);
  if (!raw) return null;
  switch (element.source) {
    case "table": {
      const data = normalizeTableData(raw);
      return data ? { kind: "table", data } : null;
    }
    case "chart": {
      const settings = normalizeChartSettings(raw.settings);
      return settings ? { kind: "chart", data: { kind: "chart", settings, rendered: text(raw.rendered, 64) } } : null;
    }
    case "flowchart": {
      const settings = normalizeFlowchartSettings(raw.settings);
      return settings ? { kind: "flowchart", data: { kind: "flowchart", settings, rendered: text(raw.rendered, 64), layout: size(raw.layout) } } : null;
    }
    case "formula": {
      const formula = normalizeFormula(raw.formula);
      return formula ? { kind: "formula", data: { kind: "formula", formula } } : null;
    }
    default:
      return null;
  }
}

export function graphicOf(element: StudioElement): StudioGraphic | null {
  if (element.kind !== "svg" || element.source === "import") return null;
  const key = record(element.data);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  const graphic = readGraphic(element);
  cache.set(key, graphic);
  return graphic;
}

export function isGraphic(element: StudioElement): element is StudioSvgElement {
  return graphicOf(element) !== null;
}

export function keepsRatio(element: StudioElement): boolean {
  const kind = graphicOf(element)?.kind;
  return kind === "flowchart" || kind === "formula";
}

export function tableScale(width: number): number {
  if (width > TABLE_FRAME.max) return width / TABLE_FRAME.max;
  if (width < TABLE_FRAME.min) return width / TABLE_FRAME.min;
  return 1;
}

export function chartFrame(width: number, height: number): { width: number; height: number; scale: number } {
  const down = Math.max(1, width / CHART_FRAME.maxWidth, height / CHART_FRAME.maxHeight);
  const up = Math.min(1, width / CHART_FRAME.minWidth, height / CHART_FRAME.minHeight);
  const scale = down > 1 ? down : up;
  return { width: clamp(width / scale, CHART_FRAME.minWidth, CHART_FRAME.maxWidth), height: clamp(height / scale, CHART_FRAME.minHeight, CHART_FRAME.maxHeight), scale };
}

export function tableSpec(data: StudioTableData, width: number): TableSpec {
  const scale = tableScale(width);
  const styled = data.styles.some((row) => row.some((style) => Object.keys(style).length > 0));
  return {
    cells: data.cells,
    columnWidths: data.columns.map((fraction) => Math.max(fraction, 0.0001)),
    align: data.align,
    width: clamp(width / scale, TABLE_FRAME.min, TABLE_FRAME.max),
    fontSize: clamp(data.fontSize / scale, MIN_TABLE_FONT, MAX_TABLE_FONT),
    fontId: data.fontId,
    header: data.header,
    border: data.border,
    color: data.color,
    borderColor: data.borderColor,
    headerFill: data.headerFill,
    stripes: data.stripes,
    stripeFill: data.stripeFill,
    borderWidth: clamp(data.borderWidth / scale, MIN_BORDER, MAX_BORDER_WIDTH),
    cellStyles: styled ? data.styles : null,
  };
}

export function chartSpec(settings: ChartSettings, width: number, height: number): ChartSpec | null {
  const frame = chartFrame(width, height);
  const result = chartData({ ...settings, width: frame.width, height: frame.height, fontSize: clamp(settings.fontSize / frame.scale, CHART_FRAME.minFont, CHART_FRAME.maxFont) });
  return result.blank ? null : result.spec;
}

export function flowchartSpec(settings: FlowchartSettings): FlowchartSpec | null {
  return isBlankFlowchart(settings) ? null : toFlowchartSpec(settings);
}

export function graphicRenderSpec(element: StudioElement): StudioGraphicSpec | null {
  const graphic = graphicOf(element);
  if (!graphic) return null;
  switch (graphic.kind) {
    case "table":
      return { kind: "table", spec: tableSpec(graphic.data, element.width) };
    case "chart": {
      const spec = chartSpec(graphic.data.settings, element.width, element.height);
      return spec ? { kind: "chart", spec } : null;
    }
    case "flowchart": {
      const spec = flowchartSpec(graphic.data.settings);
      return spec ? { kind: "flowchart", spec } : null;
    }
    case "formula":
      return null;
  }
}

export function hashText(value: string): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(36);
}

export function renderKeyOf(graphic: StudioGraphicSpec): string {
  return hashText(JSON.stringify(graphic));
}

function renderedOf(graphic: StudioGraphic): string | null {
  return graphic.kind === "formula" ? null : graphic.data.rendered;
}

export function graphicJob(element: StudioElement): GraphicJob | null {
  const graphic = graphicOf(element);
  if (!graphic) return null;
  const spec = graphicRenderSpec(element);
  if (!spec) return null;
  const key = renderKeyOf(spec);
  return key === renderedOf(graphic) ? null : { id: element.id, key, graphic: spec };
}

export function stretchSvg(svg: string): string {
  return svg.replace(SVG_ROOT, (tag) => (/\spreserveAspectRatio=/.test(tag) ? tag.replace(/\spreserveAspectRatio="[^"]*"/, ' preserveAspectRatio="none"') : tag.replace(/^<svg\b/, '<svg preserveAspectRatio="none"')));
}

export function formulaSvg(formula: FormulaSource): string {
  const sized = coloredFormulaSvg(formula.svg, formula.color).replace(/^<svg\b/, `<svg width="${round(formula.emWidth * 100)}" height="${round(formula.emHeight * 100)}"`);
  return stretchSvg(sized);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function tableLayout(result: RenderedGraphic): TableLayout | null {
  if (!result.rowHeights?.length || !result.columnWidths?.length) return null;
  return { width: result.width, height: result.height, rows: result.rowHeights, columns: result.columnWidths };
}

export function withRendered(element: StudioSvgElement, job: GraphicJob, result: RenderedGraphic): StudioSvgElement {
  const graphic = graphicOf(element);
  if (!graphic || graphic.kind === "formula") return element;
  const svg = stretchSvg(result.svg);
  switch (graphic.kind) {
    case "table": {
      const height = result.width > 0 ? (result.height * element.width) / result.width : element.height;
      return { ...element, svg, height, data: { ...graphic.data, rendered: job.key, layout: tableLayout(result) } };
    }
    case "chart":
      return { ...element, svg, data: { ...graphic.data, rendered: job.key } };
    case "flowchart": {
      const scale = graphic.data.layout ? element.width / graphic.data.layout.width : element.width / result.width;
      return { ...element, svg, width: result.width * scale, height: result.height * scale, data: { ...graphic.data, rendered: job.key, layout: { width: result.width, height: result.height } } };
    }
  }
}

export function graphicTexts(element: StudioElement): string[] {
  const graphic = graphicOf(element);
  return graphic?.kind === "table" ? graphic.data.cells.flat() : [];
}

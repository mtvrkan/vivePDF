import { PdfAnnotationBorderStyle, PdfAnnotationLineEnding, PdfAnnotationSubtype, type LineEndings } from "@embedpdf/models";

export const STROKE_TOOLS = new Set(["ink", "square", "circle", "line", "lineArrow"]);
export const FILL_TOOLS = new Set(["square", "circle"]);
export const SUBTYPE_TOOLS: Partial<Record<PdfAnnotationSubtype, string>> = {
  [PdfAnnotationSubtype.SQUARE]: "square",
  [PdfAnnotationSubtype.CIRCLE]: "circle",
  [PdfAnnotationSubtype.INK]: "ink",
  [PdfAnnotationSubtype.LINE]: "line",
  [PdfAnnotationSubtype.POLYLINE]: "lineArrow",
  [PdfAnnotationSubtype.FREETEXT]: "freeText",
  [PdfAnnotationSubtype.HIGHLIGHT]: "highlight",
  [PdfAnnotationSubtype.UNDERLINE]: "underline",
  [PdfAnnotationSubtype.STRIKEOUT]: "strikeout",
  [PdfAnnotationSubtype.SQUIGGLY]: "squiggly",
};
export const NO_FILL = "transparent";
export const DASH_PATTERN = [4, 3];
export const DASH_TOOLS = new Set(["square", "circle", "line", "lineArrow"]);
export const TEXT_TOOLS = new Set(["freeText"]);
export const LINE_TOOLS = new Set(["line", "lineArrow"]);
export const RULED_MARKUP_TOOLS = new Set(["underline", "strikeout", "squiggly"]);
export const LINE_ENDING_OPTIONS: PdfAnnotationLineEnding[] = [
  PdfAnnotationLineEnding.None,
  PdfAnnotationLineEnding.OpenArrow,
  PdfAnnotationLineEnding.ClosedArrow,
  PdfAnnotationLineEnding.Circle,
  PdfAnnotationLineEnding.Square,
  PdfAnnotationLineEnding.Diamond,
  PdfAnnotationLineEnding.Butt,
];
export const LINE_ENDING_LABEL_KEYS: Record<string, string> = {
  [PdfAnnotationLineEnding.None]: "annotate.endNone",
  [PdfAnnotationLineEnding.OpenArrow]: "annotate.endOpenArrow",
  [PdfAnnotationLineEnding.ClosedArrow]: "annotate.endClosedArrow",
  [PdfAnnotationLineEnding.Circle]: "annotate.endCircle",
  [PdfAnnotationLineEnding.Square]: "annotate.endSquare",
  [PdfAnnotationLineEnding.Diamond]: "annotate.endDiamond",
  [PdfAnnotationLineEnding.Butt]: "annotate.endButt",
};
export const DEFAULT_LINE_ENDINGS: Record<string, LineEndings> = {
  line: { start: PdfAnnotationLineEnding.None, end: PdfAnnotationLineEnding.None },
  lineArrow: { start: PdfAnnotationLineEnding.None, end: PdfAnnotationLineEnding.OpenArrow },
};
export const FALLBACK_COLORS = ["#FFD400", "#FF6B00", "#E5484D", "#D6409F", "#8E4EC6", "#3E63DD", "#0090FF", "#12A594", "#30A46C", "#000000"];
export const MIN_STROKE_WIDTH = 0.5;
export const MAX_STROKE_WIDTH = 24;
export const STROKE_WIDTH_STEP = 0.5;

export type StylePatch = { color?: string; strokeColor?: string; fontColor?: string; strokeWidth?: number; opacity?: number; strokeStyle?: PdfAnnotationBorderStyle; strokeDashArray?: number[]; lineEndings?: LineEndings };
export type StyleValues = { color?: string; fill?: string | null; strokeWidth?: number; opacity?: number; dashed?: boolean; lineEndings?: LineEndings };

export function toolColorFrom(toolId: string, defaults: Record<string, unknown> | undefined): string | null {
  const key = STROKE_TOOLS.has(toolId) || RULED_MARKUP_TOOLS.has(toolId) ? "strokeColor" : TEXT_TOOLS.has(toolId) ? "fontColor" : "color";
  const value = defaults?.[key];
  return typeof value === "string" ? value : null;
}

export function stylePatchFor(toolId: string, values: StyleValues): StylePatch {
  const patch: StylePatch = {};
  const { color, fill, strokeWidth, opacity, dashed, lineEndings } = values;
  if (color) {
    if (!STROKE_TOOLS.has(toolId) && !TEXT_TOOLS.has(toolId)) patch.color = color;
    if (STROKE_TOOLS.has(toolId) || RULED_MARKUP_TOOLS.has(toolId)) patch.strokeColor = color;
    if (TEXT_TOOLS.has(toolId)) patch.fontColor = color;
  }
  if (fill !== undefined && FILL_TOOLS.has(toolId)) patch.color = fill ?? NO_FILL;
  if (strokeWidth !== undefined && STROKE_TOOLS.has(toolId)) patch.strokeWidth = strokeWidth;
  if (opacity !== undefined) patch.opacity = opacity;
  if (dashed !== undefined && DASH_TOOLS.has(toolId)) {
    patch.strokeStyle = dashed ? PdfAnnotationBorderStyle.DASHED : PdfAnnotationBorderStyle.SOLID;
    patch.strokeDashArray = dashed ? DASH_PATTERN : [];
  }
  if (lineEndings !== undefined && LINE_TOOLS.has(toolId)) patch.lineEndings = lineEndings;
  return patch;
}


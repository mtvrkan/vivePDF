export const ANNOTATION_COLORS = ["#E44234", "#FFCD45", "#2EA043", "#1F6FEB", "#8957E5", "#1F2328"] as const;

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

export const STROKE_WIDTHS = [2, 4, 8] as const;

export type StrokeWidth = (typeof STROKE_WIDTHS)[number];

export const ANNOTATE_TOOLS = ["ink", "inkHighlighter", "highlight", "underline", "strikeout", "textComment", "square", "circle", "lineArrow"] as const;

export type AnnotateTool = (typeof ANNOTATE_TOOLS)[number];

const STROKED: ReadonlySet<AnnotateTool> = new Set(["ink", "square", "circle", "lineArrow"]);
const OUTLINED: ReadonlySet<AnnotateTool> = new Set(["square", "circle", "lineArrow"]);
const TEXT_MARKUP: ReadonlySet<AnnotateTool> = new Set(["highlight", "underline", "strikeout"]);

export function isAnnotateTool(value: unknown): value is AnnotateTool {
  return typeof value === "string" && (ANNOTATE_TOOLS as readonly string[]).includes(value);
}

export function hasStrokeWidth(tool: AnnotateTool): boolean {
  return STROKED.has(tool);
}

export function worksOnText(tool: AnnotateTool): boolean {
  return TEXT_MARKUP.has(tool);
}

export function toolDefaults(tool: AnnotateTool, color: AnnotationColor, width: StrokeWidth): Record<string, unknown> {
  if (tool === "inkHighlighter") return { strokeColor: color, color, strokeWidth: width * 4 };
  if (OUTLINED.has(tool)) return { strokeColor: color, strokeWidth: width };
  if (STROKED.has(tool)) return { strokeColor: color, color, strokeWidth: width };
  return { strokeColor: color, color };
}

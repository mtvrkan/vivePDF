import { PdfAnnotationBorderStyle } from "@embedpdf/models";
import { DASH_TOOLS, FILL_TOOLS, NO_FILL, STROKE_TOOLS, SUBTYPE_TOOLS, toolColorFrom, type StyleValues } from "./annotateStyle";

export function styleValuesOf(object: { type: number }): StyleValues {
  const tool = SUBTYPE_TOOLS[object.type as keyof typeof SUBTYPE_TOOLS];
  if (!tool) return {};
  const source = object as unknown as Record<string, unknown>;
  const values: StyleValues = {};
  const color = toolColorFrom(tool, source);
  if (color) values.color = color;
  if (FILL_TOOLS.has(tool)) {
    const fill = source.color;
    values.fill = typeof fill === "string" && fill !== NO_FILL ? fill : null;
  }
  if (STROKE_TOOLS.has(tool) && typeof source.strokeWidth === "number") values.strokeWidth = source.strokeWidth;
  if (typeof source.opacity === "number") values.opacity = source.opacity;
  if (DASH_TOOLS.has(tool)) values.dashed = source.strokeStyle === PdfAnnotationBorderStyle.DASHED;
  return values;
}

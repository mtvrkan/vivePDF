import type { PdfAnnotationObject, Rect } from "@embedpdf/models";
import { FALLBACK_COLORS, stylePatchFor, toolColorFrom } from "./annotateStyle";
import { MARKUP_SUBTYPES, markupRequests } from "./selectionMarkup";

export type MarkupToolId = "highlight" | "underline" | "strikeout" | "squiggly";

type AnnotationTarget = { createAnnotation: (pageIndex: number, annotation: PdfAnnotationObject) => unknown };
type SelectionTarget = { getHighlightRects: () => unknown; clear: () => void };
type ToolSource = { getTool: (toolId: string) => { defaults?: unknown } | undefined | null };

export type MarkupSelectionInput = {
  annotation: AnnotationTarget | null | undefined;
  selection: SelectionTarget | null | undefined;
  toolId: string;
  color: string;
  opacity?: number;
  defaults?: object;
};

export function markupSelection({ annotation, selection, toolId, color, opacity, defaults = {} }: MarkupSelectionInput): number {
  const subtype = MARKUP_SUBTYPES[toolId];
  if (subtype === undefined || !annotation || !selection) return 0;
  const requests = markupRequests((selection.getHighlightRects() ?? {}) as Record<string, Rect[]>);
  if (requests.length === 0) return 0;
  for (const request of requests) {
    annotation.createAnnotation(request.pageIndex, {
      ...defaults,
      ...stylePatchFor(toolId, { color, opacity }),
      type: subtype,
      id: crypto.randomUUID(),
      pageIndex: request.pageIndex,
      rect: request.rect,
      segmentRects: request.segmentRects,
    } as PdfAnnotationObject);
  }
  selection.clear();
  return requests.length;
}

export function toolDefaultsOf(tools: ToolSource | null | undefined, toolId: string): Record<string, unknown> {
  return (tools?.getTool(toolId)?.defaults ?? {}) as Record<string, unknown>;
}

export function markSelectionWithTool(tools: ToolSource | null | undefined, annotation: AnnotationTarget | null | undefined, selection: SelectionTarget | null | undefined, toolId: MarkupToolId): number {
  const defaults = toolDefaultsOf(tools, toolId);
  const color = toolColorFrom(toolId, defaults) ?? FALLBACK_COLORS[0];
  return markupSelection({ annotation, selection, toolId, color, defaults });
}

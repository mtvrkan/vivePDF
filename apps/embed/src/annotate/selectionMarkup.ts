import { PdfAnnotationSubtype, type Rect } from "@embedpdf/models";
import type { AnnotateTool } from "./tools";

export type MarkupRequest = { pageIndex: number; rect: Rect; segmentRects: Rect[] };

const MARKUP_SUBTYPES: Partial<Record<AnnotateTool, PdfAnnotationSubtype>> = {
  highlight: PdfAnnotationSubtype.HIGHLIGHT,
  underline: PdfAnnotationSubtype.UNDERLINE,
  strikeout: PdfAnnotationSubtype.STRIKEOUT,
};

export function markupSubtype(tool: AnnotateTool): PdfAnnotationSubtype | null {
  return MARKUP_SUBTYPES[tool] ?? null;
}

function boundingRect(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.origin.x));
  const top = Math.min(...rects.map((rect) => rect.origin.y));
  const right = Math.max(...rects.map((rect) => rect.origin.x + rect.size.width));
  const bottom = Math.max(...rects.map((rect) => rect.origin.y + rect.size.height));
  return { origin: { x: left, y: top }, size: { width: right - left, height: bottom - top } };
}

export function markupRequests(highlightRects: Record<string, readonly Rect[]>): MarkupRequest[] {
  return Object.entries(highlightRects)
    .filter(([, rects]) => rects.length > 0)
    .map(([pageIndex, rects]) => ({ pageIndex: Number(pageIndex), rect: boundingRect(rects), segmentRects: [...rects] }))
    .sort((left, right) => left.pageIndex - right.pageIndex);
}

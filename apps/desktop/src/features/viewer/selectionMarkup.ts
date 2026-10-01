import { PdfAnnotationSubtype, type Rect } from "@embedpdf/models";

export const MARKUP_SUBTYPES: Record<string, PdfAnnotationSubtype> = {
  highlight: PdfAnnotationSubtype.HIGHLIGHT,
  underline: PdfAnnotationSubtype.UNDERLINE,
  strikeout: PdfAnnotationSubtype.STRIKEOUT,
  squiggly: PdfAnnotationSubtype.SQUIGGLY,
};

export type MarkupRequest = { pageIndex: number; rect: Rect; segmentRects: Rect[] };

export function boundingRect(rects: Rect[]): Rect {
  const first = rects[0];
  if (!first) return { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } };
  let minX = first.origin.x;
  let minY = first.origin.y;
  let maxX = first.origin.x + first.size.width;
  let maxY = first.origin.y + first.size.height;
  for (const rect of rects) {
    minX = Math.min(minX, rect.origin.x);
    minY = Math.min(minY, rect.origin.y);
    maxX = Math.max(maxX, rect.origin.x + rect.size.width);
    maxY = Math.max(maxY, rect.origin.y + rect.size.height);
  }
  return { origin: { x: minX, y: minY }, size: { width: maxX - minX, height: maxY - minY } };
}

export function markupRequests(highlightRects: Record<string, Rect[]>): MarkupRequest[] {
  return Object.entries(highlightRects)
    .filter(([, rects]) => rects.length > 0)
    .map(([pageIndex, rects]) => ({ pageIndex: Number(pageIndex), rect: boundingRect(rects), segmentRects: rects }))
    .sort((left, right) => left.pageIndex - right.pageIndex);
}

export function hasSelectionRects(highlightRects: Record<string, Rect[]> | null | undefined): boolean {
  if (!highlightRects) return false;
  return Object.values(highlightRects).some((rects) => rects.length > 0);
}

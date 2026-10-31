import { expandRect, rectFromPoints, type PdfInkListObject, type Rect } from "@embedpdf/models";

export type InkStyle = { toolId: string; strokeColor: string; strokeWidth: number };

export type OpenDrawing = InkStyle & { pageIndex: number; id: string };

export type InkTarget = { strokeColor?: string; strokeWidth?: number; inkList: PdfInkListObject[] };

export function inkBounds(strokes: readonly PdfInkListObject[], strokeWidth: number): Rect {
  return expandRect(rectFromPoints(strokes.flatMap((stroke) => stroke.points)), strokeWidth / 2);
}

export function joinStrokes(existing: readonly PdfInkListObject[], added: readonly PdfInkListObject[], strokeWidth: number): { inkList: PdfInkListObject[]; rect: Rect } {
  const inkList = [...existing, ...added];
  return { inkList, rect: inkBounds(inkList, strokeWidth) };
}

export function continuesDrawing(open: OpenDrawing | null, pageIndex: number, style: InkStyle, target: InkTarget | null): open is OpenDrawing {
  if (!open || !target) return false;
  if (open.pageIndex !== pageIndex || open.toolId !== style.toolId) return false;
  if (open.strokeColor !== style.strokeColor || open.strokeWidth !== style.strokeWidth) return false;
  return target.strokeColor === style.strokeColor && target.strokeWidth === style.strokeWidth;
}

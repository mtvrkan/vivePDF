import { create } from "zustand";
import type { PdfAnnotationObject, Rect } from "@embedpdf/models";
import { SUBTYPE_TOOLS } from "./annotateStyle";

export type MarkRef = { pageIndex: number; id: string };

type AreaSelectState = {
  documentId: string | null;
  toggle: (documentId: string) => void;
  stop: () => void;
};

export const useAreaSelectStore = create<AreaSelectState>((set) => ({
  documentId: null,
  toggle: (documentId) => set((state) => ({ documentId: state.documentId === documentId ? null : documentId })),
  stop: () => set({ documentId: null }),
}));

export function isMark(object: PdfAnnotationObject): boolean {
  return SUBTYPE_TOOLS[object.type] !== undefined;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.origin.x < b.origin.x + b.size.width && b.origin.x < a.origin.x + a.size.width && a.origin.y < b.origin.y + b.size.height && b.origin.y < a.origin.y + a.size.height;
}

export function marksInArea(objects: PdfAnnotationObject[], area: Rect): PdfAnnotationObject[] {
  return objects.filter((object) => isMark(object) && overlaps(object.rect, area));
}

export function allMarks(byUid: Record<string, { object: PdfAnnotationObject }>): MarkRef[] {
  return Object.values(byUid)
    .map((tracked) => tracked.object)
    .filter(isMark)
    .map((object) => ({ pageIndex: object.pageIndex, id: object.id }));
}

export function areaBetween(start: { x: number; y: number }, end: { x: number; y: number }, scale: number): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { origin: { x: x / scale, y: y / scale }, size: { width: Math.abs(end.x - start.x) / scale, height: Math.abs(end.y - start.y) / scale } };
}

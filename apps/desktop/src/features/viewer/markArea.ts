import { create } from "zustand";
import type { PdfAnnotationObject, Rect } from "@embedpdf/models";
import { SUBTYPE_TOOLS } from "./annotateStyle";

export type MarkRef = { pageIndex: number; id: string };

export type MarkToolMode = "area" | "erase";

export const MIN_ERASER_SIZE = 4;
export const MAX_ERASER_SIZE = 40;
export const DEFAULT_ERASER_SIZE = 10;

type MarkToolState = {
  documentId: string | null;
  mode: MarkToolMode | null;
  eraserSize: number;
  toggle: (documentId: string, mode: MarkToolMode) => void;
  stop: () => void;
  setEraserSize: (size: number) => void;
};

export const useMarkToolStore = create<MarkToolState>((set) => ({
  documentId: null,
  mode: null,
  eraserSize: DEFAULT_ERASER_SIZE,
  toggle: (documentId, mode) => set((state) => (state.documentId === documentId && state.mode === mode ? { documentId: null, mode: null } : { documentId, mode })),
  stop: () => set({ documentId: null, mode: null }),
  setEraserSize: (size) => set({ eraserSize: Math.min(MAX_ERASER_SIZE, Math.max(MIN_ERASER_SIZE, size)) }),
}));

export function useMarkToolMode(documentId: string): MarkToolMode | null {
  return useMarkToolStore((state) => (state.documentId === documentId ? state.mode : null));
}

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

import { useDocumentStore } from "@/shared/store/documentStore";
import { quarterTurns, type QuarterTurns } from "./pageFrame";

export function visiblePageSize(documentId: string, pageIndex: number, fallbackWidthPx: number, fallbackHeightPx: number): { width: number; height: number } {
  const info = useDocumentStore.getState().documents[documentId]?.info;
  const size = info?.pageSizes[pageIndex];
  if (!size) return { width: fallbackWidthPx, height: fallbackHeightPx };
  return { width: size.width, height: size.height };
}

export function pageTurns(documentId: string, pageIndex: number): QuarterTurns {
  const size = useDocumentStore.getState().documents[documentId]?.info?.pageSizes[pageIndex];
  return quarterTurns(size?.rotation ?? 0);
}

type PageRect = { x0: number; y0: number; x1: number; y1: number };

export function unrotatedRect(rect: PageRect, rotation: number, visible: { width: number; height: number }): PageRect {
  const turns = quarterTurns(rotation);
  const unturn = (x: number, y: number) => {
    if (turns === 1) return { x: y, y: visible.width - x };
    if (turns === 2) return { x: visible.width - x, y: visible.height - y };
    if (turns === 3) return { x: visible.height - y, y: x };
    return { x, y };
  };
  const start = unturn(rect.x0, rect.y0);
  const end = unturn(rect.x1, rect.y1);
  return { x0: Math.min(start.x, end.x), y0: Math.min(start.y, end.y), x1: Math.max(start.x, end.x), y1: Math.max(start.y, end.y) };
}

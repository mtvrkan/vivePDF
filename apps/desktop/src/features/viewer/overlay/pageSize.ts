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

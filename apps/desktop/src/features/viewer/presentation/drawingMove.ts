import { translateDrawing } from "@/shared/lib/drawingGeometry";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { Stroke, StrokePoint } from "@/shared/store/presentationStore";

export const PICK_TOLERANCE_PX = 6;
export const DRAG_THRESHOLD_PX = 3;

export type DrawingMove = { original: Stroke; start: StrokePoint; moved: boolean };

export function movedDrawing(move: DrawingMove, point: StrokePoint, size: { width: number; height: number }): Stroke | null {
  const dx = point.x - move.start.x;
  const dy = point.y - move.start.y;
  if (!move.moved && Math.hypot(dx * size.width, dy * size.height) < DRAG_THRESHOLD_PX) return null;
  move.moved = true;
  return translateDrawing(move.original, dx, dy);
}

export function activePageWidth(pageIndex: number): number | undefined {
  const { activeId, documents } = useDocumentStore.getState();
  return activeId ? documents[activeId]?.info?.pageSizes.at(pageIndex)?.width : undefined;
}

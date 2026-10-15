import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationLeftoverStore, type LeftoverFinish } from "@/shared/store/presentationLeftoverStore";
import { usePresentationStore, type BoardMode, type Stroke } from "@/shared/store/presentationStore";
import { hasPresentationDrawings, presentationDrawings } from "./drawingsToPdf";

function insertedItems(strokes: readonly Stroke[]): Stroke[] {
  return strokes.filter((stroke) => stroke.tool === "drawing");
}

function itemsOnly(strokesByPage: Record<number, Stroke[]>, boardStrokes: Record<BoardMode, Stroke[]>) {
  return {
    strokesByPage: Object.fromEntries(Object.entries(strokesByPage).map(([page, strokes]) => [page, insertedItems(strokes)])),
    boardStrokes: { black: insertedItems(boardStrokes.black), white: insertedItems(boardStrokes.white) },
  };
}

export function holdTemporaryDrawings(finish: LeftoverFinish): void {
  const presentation = usePresentationStore.getState();
  const documentId = useDocumentStore.getState().activeId;
  if (!documentId) return;
  const kept = presentation.drawingsMode === "temporary" ? { strokesByPage: presentation.strokesByPage, boardStrokes: presentation.boardStrokes } : itemsOnly(presentation.strokesByPage, presentation.boardStrokes);
  const drawings = presentationDrawings({ ...kept, drawingAssets: presentation.drawingAssets }, presentation.boardSize ?? { width: window.innerWidth, height: window.innerHeight });
  if (!hasPresentationDrawings(drawings)) return;
  usePresentationLeftoverStore.getState().hold({ ...drawings, documentId, finish });
}

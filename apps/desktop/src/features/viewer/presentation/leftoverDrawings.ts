import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationLeftoverStore, type LeftoverFinish } from "@/shared/store/presentationLeftoverStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { hasPresentationDrawings, presentationDrawings } from "./drawingsToPdf";

export function holdTemporaryDrawings(finish: LeftoverFinish): void {
  const presentation = usePresentationStore.getState();
  const documentId = useDocumentStore.getState().activeId;
  if (presentation.drawingsMode !== "temporary" || !documentId) return;
  const drawings = presentationDrawings({ strokesByPage: presentation.strokesByPage, boardStrokes: presentation.boardStrokes, drawingAssets: presentation.drawingAssets }, presentation.boardSize ?? { width: window.innerWidth, height: window.innerHeight });
  if (!hasPresentationDrawings(drawings)) return;
  usePresentationLeftoverStore.getState().hold({ ...drawings, documentId, finish });
}

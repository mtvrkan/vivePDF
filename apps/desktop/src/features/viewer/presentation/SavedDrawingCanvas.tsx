import type { ComponentProps } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { StrokePoint } from "@/shared/store/presentationStore";
import { annotationStateOf } from "../annotationState";
import { editSavedPresentationDrawing } from "./drawingInsert";
import { PresentationCanvas } from "./PresentationCanvas";

function useSavedDrawingEdit(documentId: string): (pageIndex: number, point: StrokePoint) => void {
  const { provides: annotation } = useAnnotation(documentId);

  return (pageIndex, point) => {
    const document = useDocumentStore.getState().documents[documentId];
    if (!annotation || !document) return;
    const exists = (id: string) => Object.values(annotationStateOf(annotation)?.byUid ?? {}).some((tracked) => tracked.object.id === id && tracked.object.pageIndex === pageIndex);
    void editSavedPresentationDrawing(pageIndex, point, {
      path: document.path,
      password: document.password ?? undefined,
      exists,
      remove: (page, id) => annotation.deleteAnnotation(page, id),
    });
  };
}

type SavedDrawingCanvasProps = Omit<ComponentProps<typeof PresentationCanvas>, "onEditSavedDrawing"> & { documentId: string };

export function SavedDrawingCanvas({ documentId, ...props }: SavedDrawingCanvasProps) {
  const editSaved = useSavedDrawingEdit(documentId);
  return <PresentationCanvas {...props} onEditSavedDrawing={editSaved} />;
}

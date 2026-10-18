import type { ComponentProps } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { StrokePoint } from "@/shared/store/presentationStore";
import { annotationStateOf } from "../annotationState";
import { editSavedPresentationDrawing } from "./drawingInsert";
import { insertedRectOnPage } from "./insertedSource";
import { PresentationCanvas } from "./PresentationCanvas";

function useSavedDrawingEdit(documentId: string): (pageIndex: number, point: StrokePoint) => void {
  const { provides: annotation } = useAnnotation(documentId);

  return (pageIndex, point) => {
    const document = useDocumentStore.getState().documents[documentId];
    if (!annotation || !document) return;
    const tracked = (id: string) => Object.values(annotationStateOf(annotation)?.byUid ?? {}).find((entry) => entry.object.id === id && entry.object.pageIndex === pageIndex)?.object;
    const rectOf = (id: string) => {
      const rect = tracked(id)?.rect;
      const size = document.info?.pageSizes[pageIndex];
      return rect && size ? insertedRectOnPage(rect, size) : null;
    };
    void editSavedPresentationDrawing(pageIndex, point, {
      path: document.path,
      password: document.password ?? undefined,
      exists: (id) => tracked(id) !== undefined,
      rectOf,
      remove: (page, id) => annotation.deleteAnnotation(page, id),
    });
  };
}

type SavedDrawingCanvasProps = Omit<ComponentProps<typeof PresentationCanvas>, "onEditSavedDrawing"> & { documentId: string };

export function SavedDrawingCanvas({ documentId, ...props }: SavedDrawingCanvasProps) {
  const editSaved = useSavedDrawingEdit(documentId);
  return <PresentationCanvas {...props} onEditSavedDrawing={editSaved} />;
}

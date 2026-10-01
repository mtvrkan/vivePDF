import { useCallback } from "react";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { splitByUnsaved, useCloseRequestStore } from "@/shared/store/closeRequestStore";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { useOpenPdf } from "./useOpenPdf";

export function useCloseDocuments() {
  const { closeDocument } = useOpenPdf();
  const { provides: historyCapability } = useHistoryCapability();

  const hasUnsavedWork = useCallback(
    (documentId: string) => {
      if (pendingChangesFor(usePendingChangesStore.getState().changes, documentId).length > 0) return true;
      try {
        return historyCapability?.forDocument(documentId).canUndo() ?? false;
      } catch {
        return false;
      }
    },
    [historyCapability],
  );

  const closeDocuments = useCallback(
    (ids: string[]) => {
      const { clean, unsaved } = splitByUnsaved(ids, hasUnsavedWork);
      clean.forEach(closeDocument);
      if (unsaved.length > 0) useCloseRequestStore.getState().enqueue(unsaved);
    },
    [closeDocument, hasUnsavedWork],
  );

  return { closeDocuments, hasUnsavedWork };
}

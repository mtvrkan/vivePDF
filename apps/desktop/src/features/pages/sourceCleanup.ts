import { releaseViewSourceOf } from "@/shared/session/viewSources";
import { useDocumentStore } from "@/shared/store/documentStore";
import { forgetOrganizerOf, hiddenDocumentIds, useOrganizerStore } from "./organizerStore";
import { forgetDocumentThumbnails } from "./thumbnailCache";

export type HiddenDocumentCloser = { isDocumentOpen: (id: string) => boolean; closeDocument: (id: string) => void };

export function droppedIds(before: Iterable<string>, after: Iterable<string>): string[] {
  const kept = new Set(after);
  return [...new Set(before)].filter((id) => !kept.has(id));
}

export function watchDocumentLifecycles(closer: () => HiddenDocumentCloser | null): () => void {
  const stopSources = useOrganizerStore.subscribe((state, previous) => {
    if (state.sources === previous.sources) return;
    for (const id of droppedIds(hiddenDocumentIds(previous.sources), hiddenDocumentIds(state.sources))) {
      forgetDocumentThumbnails(id);
      const manager = closer();
      if (manager?.isDocumentOpen(id)) manager.closeDocument(id);
      releaseViewSourceOf(id);
    }
  });
  const stopDocuments = useDocumentStore.subscribe((state, previous) => {
    if (state.documents === previous.documents) return;
    for (const id of droppedIds(Object.keys(previous.documents), Object.keys(state.documents))) {
      forgetDocumentThumbnails(id);
      forgetOrganizerOf(id);
    }
  });
  return () => {
    stopSources();
    stopDocuments();
  };
}

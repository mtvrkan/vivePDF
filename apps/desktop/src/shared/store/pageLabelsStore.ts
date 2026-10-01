import { useEffect } from "react";
import { create } from "zustand";
import type { PageLabels } from "@/shared/lib/pageLabels";
import { getPageLabels } from "@/shared/rpc/documents";
import { useDocumentStore } from "@/shared/store/documentStore";

type PageLabelsState = {
  labels: Record<string, PageLabels>;
  pending: Record<string, true>;
  ensure: (documentId: string, path: string, password: string | null) => void;
  forget: (documentId: string) => void;
};

export const usePageLabelsStore = create<PageLabelsState>((set, get) => ({
  labels: {},
  pending: {},
  ensure: (documentId, path, password) => {
    if (documentId in get().labels || get().pending[documentId]) return;
    set((state) => ({ pending: { ...state.pending, [documentId]: true } }));
    const settle = (labels: PageLabels) =>
      set((state) => {
        const pending = { ...state.pending };
        delete pending[documentId];
        return { pending, labels: { ...state.labels, [documentId]: labels } };
      });
    getPageLabels({ path, password: password ?? undefined }).then(
      (result) => settle(result.labels),
      () => settle(null),
    );
  },
  forget: (documentId) =>
    set((state) => {
      if (!(documentId in state.labels)) return state;
      const labels = { ...state.labels };
      delete labels[documentId];
      return { labels };
    }),
}));

export function usePageLabels(documentId: string): PageLabels {
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const password = useDocumentStore((state) => state.documents[documentId]?.password ?? null);
  const labels = usePageLabelsStore((state) => state.labels[documentId] ?? null);

  useEffect(() => {
    if (path) usePageLabelsStore.getState().ensure(documentId, path, password);
  }, [documentId, path, password]);

  return labels;
}

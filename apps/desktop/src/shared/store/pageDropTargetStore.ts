import { create } from "zustand";

type PageDropTargetState = {
  documentId: string | null;
  setDocumentId: (documentId: string | null) => void;
};

export const usePageDropTargetStore = create<PageDropTargetState>((set) => ({
  documentId: null,
  setDocumentId: (documentId) => set({ documentId }),
}));

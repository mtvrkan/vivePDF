import { create } from "zustand";

export type ScrollDirection = "vertical" | "horizontal";

type PageDisplayState = {
  scrollByDocument: Record<string, ScrollDirection>;
  setScroll: (documentId: string, direction: ScrollDirection) => void;
  forget: (documentId: string) => void;
};

export const usePageDisplayStore = create<PageDisplayState>((set, get) => ({
  scrollByDocument: {},
  setScroll: (documentId, direction) => set({ scrollByDocument: { ...get().scrollByDocument, [documentId]: direction } }),
  forget: (documentId) =>
    set((state) => {
      if (!(documentId in state.scrollByDocument)) return state;
      const scrollByDocument = { ...state.scrollByDocument };
      delete scrollByDocument[documentId];
      return { scrollByDocument };
    }),
}));

export function scrollDirectionOf(state: PageDisplayState, documentId: string): ScrollDirection {
  return state.scrollByDocument[documentId] ?? "vertical";
}

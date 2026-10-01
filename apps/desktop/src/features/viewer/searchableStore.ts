import { create } from "zustand";

export type SearchableTarget = { pageIndex: number } | "document";

type SearchableState = {
  pending: SearchableTarget | null;
  request: (target: SearchableTarget) => void;
  cancel: () => void;
};

export const useSearchableStore = create<SearchableState>((set) => ({
  pending: null,
  request: (target) => set({ pending: target }),
  cancel: () => set({ pending: null }),
}));

export function requestSearchable(target: SearchableTarget) {
  useSearchableStore.getState().request(target);
}

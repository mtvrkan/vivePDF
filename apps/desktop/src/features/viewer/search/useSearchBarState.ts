import { create } from "zustand";

type SearchBarState = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  resultsOpen: boolean;
  focusNonce: number;
  setQuery: (query: string) => void;
  setCaseSensitive: (value: boolean) => void;
  setWholeWord: (value: boolean) => void;
  setResultsOpen: (value: boolean) => void;
  requestFocus: () => void;
};

export const useSearchBarState = create<SearchBarState>((set) => ({
  query: "",
  caseSensitive: false,
  wholeWord: false,
  resultsOpen: false,
  focusNonce: 0,
  setQuery: (query) => set({ query }),
  setCaseSensitive: (caseSensitive) => set({ caseSensitive }),
  setWholeWord: (wholeWord) => set({ wholeWord }),
  setResultsOpen: (resultsOpen) => set({ resultsOpen }),
  requestFocus: () => set((state) => ({ focusNonce: state.focusNonce + 1 })),
}));

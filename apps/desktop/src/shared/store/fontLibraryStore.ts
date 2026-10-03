import { create } from "zustand";

type FontLibraryState = { revision: number; changed: () => void };

export const useFontLibraryStore = create<FontLibraryState>((set) => ({
  revision: 0,
  changed: () => set((state) => ({ revision: state.revision + 1 })),
}));

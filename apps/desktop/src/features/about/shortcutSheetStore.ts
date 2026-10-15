import { create } from "zustand";

export type StudioScreen = "design" | "document" | null;

type ShortcutSheetState = {
  open: boolean;
  studioScreen: StudioScreen;
  show: () => void;
  toggle: () => void;
  close: () => void;
  setStudioScreen: (screen: StudioScreen) => void;
};

export const useShortcutSheetStore = create<ShortcutSheetState>((set) => ({
  open: false,
  studioScreen: null,
  show: () => set({ open: true }),
  toggle: () => set((state) => ({ open: !state.open })),
  close: () => set({ open: false }),
  setStudioScreen: (studioScreen) => set({ studioScreen }),
}));

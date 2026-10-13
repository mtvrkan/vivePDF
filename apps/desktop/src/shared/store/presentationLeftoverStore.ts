import { create } from "zustand";
import type { PresentationBoardDrawings, PresentationPageDrawings } from "@/types";

export type LeftoverFinish = "ask" | "save";

export type LeftoverDrawings = { documentId: string; finish: LeftoverFinish; pages: PresentationPageDrawings[]; boards: PresentationBoardDrawings[] };

type LeftoverState = {
  leftover: LeftoverDrawings | null;
  hold: (leftover: LeftoverDrawings) => void;
  clear: () => void;
};

export const usePresentationLeftoverStore = create<LeftoverState>((set) => ({
  leftover: null,
  hold: (leftover) => set({ leftover }),
  clear: () => set({ leftover: null }),
}));

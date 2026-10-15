import { create } from "zustand";
import type { BoardMode, Stroke } from "@/shared/store/presentationStore";

export type BoardLiveStroke = { board: BoardMode; stroke: Stroke };

type BoardLiveState = {
  live: BoardLiveStroke | null;
  publish: (live: BoardLiveStroke | null) => void;
};

export const useBoardLiveStore = create<BoardLiveState>((set) => ({
  live: null,
  publish: (live) => set({ live }),
}));

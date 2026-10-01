import { create } from "zustand";

export const AUTO_SCROLL_SPEEDS = [15, 30, 50, 80, 120, 180, 270, 400] as const;
const DEFAULT_SPEED_INDEX = 2;

type AutoScrollState = {
  running: boolean;
  speedIndex: number;
  backwards: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  faster: () => void;
  slower: () => void;
  reverse: () => void;
};

export const useAutoScrollStore = create<AutoScrollState>((set, get) => ({
  running: false,
  speedIndex: DEFAULT_SPEED_INDEX,
  backwards: false,
  start: () => set({ running: true, backwards: false }),
  stop: () => set({ running: false }),
  toggle: () => (get().running ? get().stop() : get().start()),
  faster: () => set({ speedIndex: Math.min(AUTO_SCROLL_SPEEDS.length - 1, get().speedIndex + 1) }),
  slower: () => set({ speedIndex: Math.max(0, get().speedIndex - 1) }),
  reverse: () => set({ backwards: !get().backwards }),
}));

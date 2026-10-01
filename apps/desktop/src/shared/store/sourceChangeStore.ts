import { create } from "zustand";

type SourceChangeState = {
  epoch: number;
  changed: () => void;
};

export const useSourceChangeStore = create<SourceChangeState>((set, get) => ({
  epoch: 0,
  changed: () => set({ epoch: get().epoch + 1 }),
}));

import { create } from "zustand";

type OperationState = {
  running: number;
  progress: number | null;
  begin: () => void;
  end: () => void;
  report: (progress: number | null) => void;
};

export const useOperationStore = create<OperationState>((set) => ({
  running: 0,
  progress: null,
  begin: () => set((state) => ({ running: state.running + 1, progress: null })),
  end: () =>
    set((state) => {
      const running = Math.max(0, state.running - 1);
      return { running, progress: running === 0 ? null : state.progress };
    }),
  report: (progress) => set((state) => (state.running === 0 ? state : { progress })),
}));

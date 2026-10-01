import { create } from "zustand";

type CloseRequestState = {
  queue: string[];
  enqueue: (ids: string[]) => void;
  advance: () => void;
  cancel: () => void;
};

export const useCloseRequestStore = create<CloseRequestState>((set) => ({
  queue: [],
  enqueue: (ids) => set((state) => ({ queue: [...state.queue, ...ids.filter((id) => !state.queue.includes(id))] })),
  advance: () => set((state) => ({ queue: state.queue.slice(1) })),
  cancel: () => set({ queue: [] }),
}));

export function splitByUnsaved(ids: string[], isUnsaved: (id: string) => boolean): { clean: string[]; unsaved: string[] } {
  const unique = [...new Set(ids)];
  return { clean: unique.filter((id) => !isUnsaved(id)), unsaved: unique.filter(isUnsaved) };
}

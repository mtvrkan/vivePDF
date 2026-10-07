import { create } from "zustand";
import { pathKey } from "@/shared/lib/paths";

export type FileChangeStatus = "missing" | "conflict" | "changed" | "stale";

type FileChangeState = {
  statuses: Record<string, FileChangeStatus>;
  mark: (path: string, status: FileChangeStatus) => void;
  clear: (path: string) => void;
  keepOnly: (paths: string[]) => void;
};

export const useFileChangeStore = create<FileChangeState>((set) => ({
  statuses: {},
  mark: (path, status) => set((state) => ({ statuses: { ...state.statuses, [pathKey(path)]: status } })),
  clear: (path) =>
    set((state) => {
      const key = pathKey(path);
      if (!(key in state.statuses)) return state;
      const statuses = { ...state.statuses };
      delete statuses[key];
      return { statuses };
    }),
  keepOnly: (paths) =>
    set((state) => {
      const kept = new Set(paths.map(pathKey));
      const entries = Object.entries(state.statuses).filter(([key]) => kept.has(key));
      if (entries.length === Object.keys(state.statuses).length) return state;
      return { statuses: Object.fromEntries(entries) };
    }),
}));

export function fileChangeStatusOf(path: string): FileChangeStatus | null {
  return useFileChangeStore.getState().statuses[pathKey(path)] ?? null;
}

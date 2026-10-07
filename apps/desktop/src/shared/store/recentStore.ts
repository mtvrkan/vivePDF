import { create } from "zustand";
import { fileNameOf } from "@/shared/rpc/files";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import type { RecentFile } from "@/types";

export const RECENT_STORAGE_KEY = "vivepdf.recent";
export const RECENT_SORT_STORAGE_KEY = "vivepdf.recentSort";
export const RECENT_SORTS = ["recent", "name", "folder"] as const;
export type RecentSort = (typeof RECENT_SORTS)[number];

function readStored(): RecentFile[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentFile =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RecentFile).path === "string" &&
        typeof (item as RecentFile).openedAt === "number" &&
        ((item as RecentFile).pinned === undefined || typeof (item as RecentFile).pinned === "boolean"),
    );
  } catch {
    return [];
  }
}

function readSort(): RecentSort {
  try {
    const raw = localStorage.getItem(RECENT_SORT_STORAGE_KEY);
    return RECENT_SORTS.find((sort) => sort === raw) ?? "recent";
  } catch {
    return "recent";
  }
}

export function samePath(a: string, b: string): boolean {
  return a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase();
}

function dedupe(items: RecentFile[]): RecentFile[] {
  return items.filter((item, index) => items.findIndex((other) => samePath(other.path, item.path)) === index);
}

function capUnpinned(items: RecentFile[], limit: number): RecentFile[] {
  let unpinned = 0;
  return items.filter((item) => item.pinned === true || ++unpinned <= limit);
}

function persist(items: RecentFile[]) {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items));
  } catch {
    return;
  }
}

function persistSort(sort: RecentSort) {
  try {
    localStorage.setItem(RECENT_SORT_STORAGE_KEY, sort);
  } catch {
    return;
  }
}

export function readRecentFiles(): RecentFile[] {
  return dedupe(readStored());
}

type RecentState = {
  items: RecentFile[];
  sort: RecentSort;
  add: (path: string) => void;
  remove: (path: string) => void;
  togglePin: (path: string) => void;
  clear: () => void;
  restore: (items: RecentFile[]) => void;
  setSort: (sort: RecentSort) => void;
};

export const useRecentStore = create<RecentState>((set) => ({
  items: readRecentFiles(),
  sort: readSort(),
  add: (path) =>
    set((state) => {
      if (!usePreferencesStore.getState().rememberRecent) return state;
      const existing = state.items.find((item) => samePath(item.path, path));
      const entry: RecentFile = { path, fileName: fileNameOf(path), openedAt: Date.now(), ...(existing?.pinned ? { pinned: true } : {}) };
      const items = capUnpinned([entry, ...state.items.filter((item) => !samePath(item.path, path))], usePreferencesStore.getState().recentLimit);
      persist(items);
      return { items };
    }),
  remove: (path) =>
    set((state) => {
      const items = state.items.filter((item) => !samePath(item.path, path));
      persist(items);
      return { items };
    }),
  togglePin: (path) =>
    set((state) => {
      const items = state.items.map((item) => (samePath(item.path, path) ? { ...item, pinned: !item.pinned } : item));
      persist(items);
      return { items };
    }),
  clear: () =>
    set((state) => {
      const items = state.items.filter((item) => item.pinned === true);
      persist(items);
      return { items };
    }),
  restore: (items) => {
    persist(items);
    set({ items });
  },
  setSort: (sort) => {
    persistSort(sort);
    set({ sort });
  },
}));

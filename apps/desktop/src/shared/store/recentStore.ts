import { create } from "zustand";
import { fileNameOf } from "@/shared/rpc/files";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import type { RecentFile } from "@/types";

export const RECENT_STORAGE_KEY = "vivepdf.recent";

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
        typeof (item as RecentFile).openedAt === "number",
    );
  } catch {
    return [];
  }
}

export function samePath(a: string, b: string): boolean {
  return a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase();
}

function dedupe(items: RecentFile[]): RecentFile[] {
  return items.filter((item, index) => items.findIndex((other) => samePath(other.path, item.path)) === index);
}

function persist(items: RecentFile[]) {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items));
  } catch {
    return;
  }
}

export function readRecentFiles(): RecentFile[] {
  return dedupe(readStored());
}

type RecentState = {
  items: RecentFile[];
  add: (path: string) => void;
  remove: (path: string) => void;
  clear: () => void;
  restore: (items: RecentFile[]) => void;
};

export const useRecentStore = create<RecentState>((set) => ({
  items: readRecentFiles(),
  add: (path) =>
    set((state) => {
      if (!usePreferencesStore.getState().rememberRecent) return state;
      const items = [
        { path, fileName: fileNameOf(path), openedAt: Date.now() },
        ...state.items.filter((item) => !samePath(item.path, path)),
      ].slice(0, usePreferencesStore.getState().recentLimit);
      persist(items);
      return { items };
    }),
  remove: (path) =>
    set((state) => {
      const items = state.items.filter((item) => !samePath(item.path, path));
      persist(items);
      return { items };
    }),
  clear: () => {
    persist([]);
    set({ items: [] });
  },
  restore: (items) => {
    persist(items);
    set({ items });
  },
}));

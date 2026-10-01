import { create } from "zustand";
import { usePreferencesStore } from "@/shared/store/preferencesStore";

export type HistoryEntry = {
  id: string;
  tool: string;
  source: string | null;
  outputs: string[];
  at: number;
};

const STORAGE_KEY = "vivepdf.history";
const MAX_ENTRIES = 100;

function readStored(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is HistoryEntry =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as HistoryEntry).id === "string" &&
        typeof (item as HistoryEntry).tool === "string" &&
        Array.isArray((item as HistoryEntry).outputs) &&
        typeof (item as HistoryEntry).at === "number",
    );
  } catch {
    return [];
  }
}

function persist(items: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    return;
  }
}

type HistoryState = {
  items: HistoryEntry[];
  add: (entry: Omit<HistoryEntry, "id" | "at">) => void;
  remove: (id: string) => void;
  clear: () => void;
  restore: (items: HistoryEntry[]) => void;
};

export const useHistoryStore = create<HistoryState>((set) => ({
  items: readStored(),
  add: (entry) =>
    set((state) => {
      if (entry.outputs.length === 0 || !usePreferencesStore.getState().keepHistory) return state;
      const items = [{ ...entry, id: crypto.randomUUID(), at: Date.now() }, ...state.items].slice(0, MAX_ENTRIES);
      persist(items);
      return { items };
    }),
  remove: (id) =>
    set((state) => {
      const items = state.items.filter((item) => item.id !== id);
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

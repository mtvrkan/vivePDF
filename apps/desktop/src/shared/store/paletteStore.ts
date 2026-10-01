import { create } from "zustand";

const RECENT_KEY = "vivepdf.paletteRecent";
const MAX_RECENT = 10;

export function readRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function persistRecentIds(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    return;
  }
}

type PaletteState = {
  isOpen: boolean;
  pendingQuery: string;
  recentIds: string[];
  open: () => void;
  close: () => void;
  toggle: () => void;
  openWith: (query: string) => void;
  consumePendingQuery: () => string;
  recordUse: (id: string) => void;
};

export const usePaletteStore = create<PaletteState>((set, get) => ({
  isOpen: false,
  pendingQuery: "",
  recentIds: readRecentIds(),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  openWith: (query) => set({ isOpen: true, pendingQuery: query }),
  consumePendingQuery: () => {
    const query = get().pendingQuery;
    set({ pendingQuery: "" });
    return query;
  },
  recordUse: (id) => {
    const ids = [id, ...get().recentIds.filter((item) => item !== id)].slice(0, MAX_RECENT);
    persistRecentIds(ids);
    set({ recentIds: ids });
  },
}));

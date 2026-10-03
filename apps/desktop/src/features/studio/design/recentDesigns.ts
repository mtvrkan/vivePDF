import { create } from "zustand";
import { pathKey } from "@/shared/lib/paths";

export const RECENT_DESIGNS_KEY = "vivepdf.studioRecent";
export const MAX_RECENT_DESIGNS = 12;

export type RecentDesign = { path: string; name: string; savedAt: number; width: number; height: number; thumbnail: string };

type RecentDesignsState = {
  items: RecentDesign[];
  add: (item: RecentDesign) => void;
  remove: (path: string) => void;
};

function valid(value: unknown): value is RecentDesign {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.path === "string" &&
    typeof item.name === "string" &&
    typeof item.savedAt === "number" &&
    typeof item.width === "number" &&
    typeof item.height === "number" &&
    typeof item.thumbnail === "string" &&
    (item.thumbnail === "" || item.thumbnail.startsWith("data:image/jpeg;base64,"))
  );
}

export function readRecentDesigns(): RecentDesign[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_DESIGNS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, MAX_RECENT_DESIGNS) : [];
  } catch {
    return [];
  }
}

function persist(items: RecentDesign[]) {
  try {
    localStorage.setItem(RECENT_DESIGNS_KEY, JSON.stringify(items));
  } catch {
    return;
  }
}

export const useRecentDesignsStore = create<RecentDesignsState>((set, get) => ({
  items: readRecentDesigns(),
  add: (item) => {
    const items = [item, ...get().items.filter((entry) => pathKey(entry.path) !== pathKey(item.path))].slice(0, MAX_RECENT_DESIGNS);
    set({ items });
    persist(items);
  },
  remove: (path) => {
    const items = get().items.filter((entry) => pathKey(entry.path) !== pathKey(path));
    set({ items });
    persist(items);
  },
}));

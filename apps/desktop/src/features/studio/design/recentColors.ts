import { create } from "zustand";

export const RECENT_COLORS_KEY = "vivepdf.studioRecentColors";
export const MAX_RECENT_COLORS = 10;

const COLOUR = /^#[0-9a-f]{6}$/i;

type RecentColorsState = {
  colors: string[];
  push: (color: string) => void;
};

export function withRecentColor(colors: readonly string[], color: string): string[] {
  if (!COLOUR.test(color)) return [...colors];
  const key = color.toLowerCase();
  return [key, ...colors.filter((item) => item !== key)].slice(0, MAX_RECENT_COLORS);
}

export function readRecentColors(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const colors = parsed.filter((item): item is string => typeof item === "string" && COLOUR.test(item)).map((item) => item.toLowerCase());
    return [...new Set(colors)].slice(0, MAX_RECENT_COLORS);
  } catch {
    return [];
  }
}

function persist(colors: string[]) {
  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(colors));
  } catch {
    return;
  }
}

export const useRecentColors = create<RecentColorsState>((set, get) => ({
  colors: readRecentColors(),
  push: (color) => {
    const colors = withRecentColor(get().colors, color);
    set({ colors });
    persist(colors);
  },
}));

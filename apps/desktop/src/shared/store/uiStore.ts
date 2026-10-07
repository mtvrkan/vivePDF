import { create } from "zustand";
import { currentLocale, setLocale } from "@/app/i18n";
import { applyTheme, readStoredTheme } from "@/app/theme";
import { DEFAULT_OUTPUT_PATTERN, readOutputPattern, storeOutputPattern } from "@/shared/lib/naming";
import type { Locale, ThemeMode } from "@/types";

const ZOOM_KEY = "vivepdf.pagesZoom";
const INSERT_PLACE_KEY = "vivepdf.pagesInsertPlace";
const APPLY_IN_PLACE_KEY = "vivepdf.pagesApplyInPlace";

export type PagesInsertPlace = "after" | "before" | "end";
export const PAGES_ZOOM_MIN = 80;
export const PAGES_ZOOM_MAX = 400;
const PAGES_ZOOM_DEFAULT = 150;

export function readStoredZoom(): number {
  try {
    const value = Number(localStorage.getItem(ZOOM_KEY));
    return value >= PAGES_ZOOM_MIN && value <= PAGES_ZOOM_MAX ? value : PAGES_ZOOM_DEFAULT;
  } catch {
    return PAGES_ZOOM_DEFAULT;
  }
}

function readStoredInsertPlace(): PagesInsertPlace {
  try {
    const value = localStorage.getItem(INSERT_PLACE_KEY);
    return value === "before" || value === "end" ? value : "after";
  } catch {
    return "after";
  }
}

function readStoredApplyInPlace(): boolean {
  try {
    return localStorage.getItem(APPLY_IN_PLACE_KEY) === "true";
  } catch {
    return false;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    void 0;
  }
}

type UiState = {
  locale: Locale;
  theme: ThemeMode;
  pagesZoom: number;
  pagesInsertPlace: PagesInsertPlace;
  pagesApplyInPlace: boolean;
  immersive: boolean;
  immersiveMounted: boolean;
  immersiveStartPage: number | null;
  outputPattern: string;
  setImmersive: (immersive: boolean, startPage?: number | null) => void;
  setImmersiveMounted: (mounted: boolean) => void;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeMode) => void;
  setPagesZoom: (zoom: number) => void;
  setPagesInsertPlace: (place: PagesInsertPlace) => void;
  setPagesApplyInPlace: (inPlace: boolean) => void;
  setOutputPattern: (pattern: string) => void;
};

export const useUiStore = create<UiState>((set) => ({
  locale: currentLocale(),
  theme: readStoredTheme(),
  pagesZoom: readStoredZoom(),
  pagesInsertPlace: readStoredInsertPlace(),
  pagesApplyInPlace: readStoredApplyInPlace(),
  immersive: false,
  immersiveMounted: false,
  immersiveStartPage: null,
  outputPattern: readOutputPattern(),
  setOutputPattern: (pattern) => {
    storeOutputPattern(pattern);
    set({ outputPattern: pattern.trim() ? pattern : DEFAULT_OUTPUT_PATTERN });
  },
  setImmersive: (immersive, startPage = null) => set({ immersive, immersiveStartPage: immersive ? startPage : null }),
  setImmersiveMounted: (mounted) => set({ immersiveMounted: mounted }),
  setPagesZoom: (zoom) => {
    const clamped = Math.round(Math.max(PAGES_ZOOM_MIN, Math.min(PAGES_ZOOM_MAX, zoom)));
    try {
      localStorage.setItem(ZOOM_KEY, String(clamped));
    } catch {
      void 0;
    }
    set({ pagesZoom: clamped });
  },
  setPagesInsertPlace: (place) => {
    store(INSERT_PLACE_KEY, place);
    set({ pagesInsertPlace: place });
  },
  setPagesApplyInPlace: (inPlace) => {
    store(APPLY_IN_PLACE_KEY, String(inPlace));
    set({ pagesApplyInPlace: inPlace });
  },
  setLocale: (locale) => {
    void setLocale(locale);
    set({ locale });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

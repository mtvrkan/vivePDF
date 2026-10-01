import { create } from "zustand";
import { currentLocale, setLocale } from "@/app/i18n";
import { applyTheme, readStoredTheme } from "@/app/theme";
import { DEFAULT_OUTPUT_PATTERN, readOutputPattern, storeOutputPattern } from "@/shared/lib/naming";
import type { Locale, ThemeMode } from "@/types";

const ZOOM_KEY = "vivepdf.pagesZoom";
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

type UiState = {
  locale: Locale;
  theme: ThemeMode;
  pagesZoom: number;
  immersive: boolean;
  immersiveMounted: boolean;
  immersiveStartPage: number | null;
  outputPattern: string;
  setImmersive: (immersive: boolean, startPage?: number | null) => void;
  setImmersiveMounted: (mounted: boolean) => void;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeMode) => void;
  setPagesZoom: (zoom: number) => void;
  setOutputPattern: (pattern: string) => void;
};

export const useUiStore = create<UiState>((set) => ({
  locale: currentLocale(),
  theme: readStoredTheme(),
  pagesZoom: readStoredZoom(),
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
  setLocale: (locale) => {
    void setLocale(locale);
    set({ locale });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

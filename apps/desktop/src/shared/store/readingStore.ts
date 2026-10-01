import { create } from "zustand";
import type { ReadingTheme, ReadingWidth } from "@/types";
import { isPageColorScheme, type PageColorScheme } from "@/shared/lib/pageColors";

const STORAGE_KEY = "vivepdf.reading";
export const READING_FONT_MIN = 14;
export const READING_FONT_MAX = 32;

type ReadingSettings = {
  fontSize: number;
  width: ReadingWidth;
  theme: ReadingTheme;
  pageColors: PageColorScheme;
  lastPageColors: Exclude<PageColorScheme, "normal">;
  rate: number;
  voiceUri: string | null;
  voiceSpeakers: Record<string, number>;
};

const DEFAULTS: ReadingSettings = { fontSize: 19, width: "medium", theme: "paper", pageColors: "normal", lastPageColors: "dark", rate: 1, voiceUri: null, voiceSpeakers: {} };

function storedSpeakers(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && entry[1] >= 0));
}

function storedPageColors(parsed: { pageColors?: unknown; invert?: unknown }): PageColorScheme {
  if (isPageColorScheme(parsed.pageColors)) return parsed.pageColors;
  return parsed.invert === true ? "dark" : "normal";
}

function storedLastPageColors(value: unknown, current: PageColorScheme): Exclude<PageColorScheme, "normal"> {
  if (current !== "normal") return current;
  return isPageColorScheme(value) && value !== "normal" ? value : "dark";
}

export function readStored(): ReadingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ReadingSettings> & { invert?: unknown };
    const pageColors = storedPageColors(parsed);
    return {
      fontSize: typeof parsed.fontSize === "number" ? Math.min(READING_FONT_MAX, Math.max(READING_FONT_MIN, parsed.fontSize)) : DEFAULTS.fontSize,
      width: parsed.width === "narrow" || parsed.width === "wide" ? parsed.width : "medium",
      theme: parsed.theme === "sepia" || parsed.theme === "dark" ? parsed.theme : "paper",
      pageColors,
      lastPageColors: storedLastPageColors(parsed.lastPageColors, pageColors),
      rate: typeof parsed.rate === "number" ? Math.min(2, Math.max(0.5, parsed.rate)) : 1,
      voiceUri: typeof parsed.voiceUri === "string" ? parsed.voiceUri : null,
      voiceSpeakers: storedSpeakers(parsed.voiceSpeakers),
    };
  } catch {
    return DEFAULTS;
  }
}

export type ActiveSentence = { page: number; index: number; start?: number; end?: number };

type ReadingState = ReadingSettings & {
  update: (patch: Partial<ReadingSettings>) => void;
  activeSentence: ActiveSentence | null;
  setActiveSentence: (value: ActiveSentence | null) => void;
  scrollRequest: number | null;
  requestPageScroll: (page: number) => void;
  clearPageScrollRequest: () => void;
};

export const useReadingStore = create<ReadingState>((set, get) => ({
  ...readStored(),
  activeSentence: null,
  scrollRequest: null,
  update: (patch) => {
    const next = { ...get(), ...patch };
    const { fontSize, width, theme, pageColors, lastPageColors, rate, voiceUri, voiceSpeakers } = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize, width, theme, pageColors, lastPageColors, rate, voiceUri, voiceSpeakers }));
    } catch {
      void 0;
    }
    set(patch);
  },
  setActiveSentence: (value) => set({ activeSentence: value }),
  requestPageScroll: (page) => set({ scrollRequest: page }),
  clearPageScrollRequest: () => set({ scrollRequest: null }),
}));

export function choosePageColors(scheme: PageColorScheme) {
  useReadingStore.getState().update(scheme === "normal" ? { pageColors: scheme } : { pageColors: scheme, lastPageColors: scheme });
}

export function togglePageColors() {
  const { pageColors, lastPageColors } = useReadingStore.getState();
  choosePageColors(pageColors === "normal" ? lastPageColors : "normal");
}

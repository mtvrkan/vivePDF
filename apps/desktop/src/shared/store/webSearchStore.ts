import { create } from "zustand";
import type { WebSearchEngine } from "@/shared/lib/webSearch";

const STORAGE_KEY = "vivepdf.webSearch";

type WebSearchSettings = {
  engine: WebSearchEngine;
  customUrl: string;
};

const DEFAULTS: WebSearchSettings = { engine: "google", customUrl: "" };
const ENGINES: WebSearchEngine[] = ["google", "bing", "duckduckgo", "startpage", "brave", "yandex", "custom"];

export function readStored(): WebSearchSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<WebSearchSettings>;
    return {
      engine: ENGINES.includes(parsed.engine as WebSearchEngine) ? (parsed.engine as WebSearchEngine) : DEFAULTS.engine,
      customUrl: typeof parsed.customUrl === "string" ? parsed.customUrl : DEFAULTS.customUrl,
    };
  } catch {
    return DEFAULTS;
  }
}

type WebSearchState = WebSearchSettings & {
  update: (patch: Partial<WebSearchSettings>) => void;
};

export const useWebSearchStore = create<WebSearchState>((set, get) => ({
  ...readStored(),
  update: (patch) => {
    const next = { engine: get().engine, customUrl: get().customUrl, ...patch };
    set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  },
}));

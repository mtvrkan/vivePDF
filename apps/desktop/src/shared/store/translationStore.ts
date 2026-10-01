import { create } from "zustand";
import { languageCodeFor } from "@/shared/lib/translateLanguage";
import { toRpcError } from "@/shared/rpc/client";
import { translateText } from "@/shared/rpc/operations";
import { useUiStore } from "@/shared/store/uiStore";
import type { RpcError, TranslateTextResult } from "@/types";

export const MAX_TRANSLATION_CHARS = 5000;
const STORAGE_KEY = "vivepdf.translation";
const LANGUAGE_PATTERN = /^[a-z]{2,3}$/;
const PIVOT = "en";

export type TranslationStatus = "idle" | "loading" | "done" | "error";

type TranslationPair = { source: string | null; target: string | null };

type TranslationState = TranslationPair & {
  text: string;
  truncated: boolean;
  status: TranslationStatus;
  progress: number | null;
  result: TranslateTextResult | null;
  error: RpcError | null;
  request: (text: string) => void;
  setPair: (pair: Partial<TranslationPair>) => void;
  swap: () => void;
  run: () => Promise<void>;
  cancel: () => void;
};

function language(value: unknown): string | null {
  return typeof value === "string" && LANGUAGE_PATTERN.test(value) ? value : null;
}

function defaultPair(): TranslationPair {
  const target = languageCodeFor(useUiStore.getState().locale);
  return { source: target === PIVOT ? null : PIVOT, target };
}

export function readStored(): TranslationPair {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPair();
    const parsed = JSON.parse(raw) as Partial<TranslationPair>;
    return { source: language(parsed.source), target: language(parsed.target) };
  } catch {
    return defaultPair();
  }
}

function persist(pair: TranslationPair) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pair));
  } catch {
    return;
  }
}

let controller: AbortController | null = null;

export const useTranslationStore = create<TranslationState>((set, get) => ({
  ...readStored(),
  text: "",
  truncated: false,
  status: "idle",
  progress: null,
  result: null,
  error: null,
  request: (text) => {
    const trimmed = text.trim();
    set({ text: trimmed.slice(0, MAX_TRANSLATION_CHARS), truncated: trimmed.length > MAX_TRANSLATION_CHARS });
    void get().run();
  },
  setPair: (pair) => {
    const next = { source: get().source, target: get().target, ...pair };
    persist(next);
    set(next);
    void get().run();
  },
  swap: () => get().setPair({ source: get().target, target: get().source }),
  run: async () => {
    const { text, source, target } = get();
    controller?.abort();
    if (!text || !source || !target) {
      controller = null;
      set({ status: "idle", progress: null, result: null, error: null });
      return;
    }
    const current = new AbortController();
    controller = current;
    set({ status: "loading", progress: null, result: null, error: null });
    try {
      const result = await translateText({ text, source, target }, { signal: current.signal, onProgress: (update) => controller === current && set({ progress: update.progress }) });
      if (controller === current) set({ status: "done", result, progress: null });
    } catch (caught) {
      if (controller !== current) return;
      const error = toRpcError(caught);
      set(error.code === "CANCELLED" ? { status: "idle", progress: null } : { status: "error", error, progress: null });
    } finally {
      if (controller === current) controller = null;
    }
  },
  cancel: () => {
    controller?.abort();
  },
}));

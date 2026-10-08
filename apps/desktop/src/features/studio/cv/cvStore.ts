import { create } from "zustand";
import type { Locale } from "@/types";
import { defaultTheme, emptyProfile, normalizeProfile, normalizeTheme, readStoredCv, writeStoredCv, type CvProfile, type CvState, type CvTheme } from "./cvModel";

const SAVE_DELAY_MS = 400;
const MERGE_WINDOW_MS = 600;
const HISTORY_LIMIT = 100;

type CvStore = {
  active: boolean;
  profile: CvProfile;
  theme: CvTheme;
  loaded: boolean;
  past: CvState[];
  future: CvState[];
  mergeKey: string | null;
  mergeAt: number;
  saveFailed: boolean;
  open: (language: Locale) => void;
  close: () => void;
  updateProfile: (change: (profile: CvProfile) => CvProfile, merge?: string) => void;
  updateTheme: (patch: Partial<CvTheme>, merge?: string) => void;
  replace: (state: CvState) => void;
  undo: () => void;
  redo: () => void;
  snapshot: () => CvState;
};

let saveTimer: number | undefined;

export const useCvStore = create<CvStore>((set, get) => {
  const save = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const saved = writeStoredCv(get().snapshot());
      if (saved === get().saveFailed) set({ saveFailed: !saved });
    }, SAVE_DELAY_MS);
  };

  const commit = (next: CvState, merge?: string) => {
    const state = get();
    if (next.profile === state.profile && next.theme === state.theme) return;
    const now = Date.now();
    const merging = merge !== undefined && merge === state.mergeKey && now - state.mergeAt < MERGE_WINDOW_MS;
    const past = merging ? state.past : [...state.past, state.snapshot()].slice(-HISTORY_LIMIT);
    set({ profile: next.profile, theme: next.theme, past, future: [], mergeKey: merge ?? null, mergeAt: now });
    save();
  };

  const travel = (from: "past" | "future") => {
    const state = get();
    const stack = state[from];
    const target = stack[stack.length - 1];
    if (!target) return;
    const current = state.snapshot();
    const rest = stack.slice(0, -1);
    set(from === "past" ? { ...target, past: rest, future: [...state.future, current], mergeKey: null } : { ...target, future: rest, past: [...state.past, current], mergeKey: null });
    save();
  };

  return {
    active: false,
    profile: emptyProfile(),
    theme: defaultTheme("en"),
    loaded: false,
    past: [],
    future: [],
    mergeKey: null,
    mergeAt: 0,
    saveFailed: false,
    open: (language) => {
      if (get().loaded) {
        set({ active: true });
        return;
      }
      const stored = readStoredCv(language);
      set({ active: true, loaded: true, profile: stored?.profile ?? emptyProfile(), theme: stored?.theme ?? defaultTheme(language), past: [], future: [], mergeKey: null });
    },
    close: () => {
      window.clearTimeout(saveTimer);
      writeStoredCv(get().snapshot());
      set({ active: false });
    },
    updateProfile: (change, merge) => {
      const state = get();
      commit({ profile: change(state.profile), theme: state.theme }, merge);
    },
    updateTheme: (patch, merge) => {
      const state = get();
      commit({ profile: state.profile, theme: { ...state.theme, ...patch } }, merge);
    },
    replace: (next) => {
      const state = get();
      commit({ profile: normalizeProfile(next.profile), theme: normalizeTheme(next.theme, state.theme.language) });
    },
    undo: () => travel("past"),
    redo: () => travel("future"),
    snapshot: () => ({ profile: get().profile, theme: get().theme }),
  };
});

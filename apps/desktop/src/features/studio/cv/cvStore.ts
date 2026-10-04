import { create } from "zustand";
import type { Locale } from "@/types";
import { defaultTheme, emptyProfile, normalizeProfile, normalizeTheme, readStoredCv, writeStoredCv, type CvProfile, type CvState, type CvTheme } from "./cvModel";

const SAVE_DELAY_MS = 400;

type CvStore = {
  active: boolean;
  profile: CvProfile;
  theme: CvTheme;
  loaded: boolean;
  open: (language: Locale) => void;
  close: () => void;
  updateProfile: (change: (profile: CvProfile) => CvProfile) => void;
  updateTheme: (patch: Partial<CvTheme>) => void;
  replace: (state: CvState) => void;
  snapshot: () => CvState;
};

let saveTimer: number | undefined;

function scheduleSave(state: CvState) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => writeStoredCv(state), SAVE_DELAY_MS);
}

export const useCvStore = create<CvStore>((set, get) => ({
  active: false,
  profile: emptyProfile(),
  theme: defaultTheme("en"),
  loaded: false,
  open: (language) => {
    if (get().loaded) {
      set({ active: true });
      return;
    }
    const stored = readStoredCv(language);
    set({ active: true, loaded: true, profile: stored?.profile ?? emptyProfile(), theme: stored?.theme ?? defaultTheme(language) });
  },
  close: () => {
    writeStoredCv(get().snapshot());
    set({ active: false });
  },
  updateProfile: (change) => {
    set((state) => ({ profile: change(state.profile) }));
    scheduleSave(get().snapshot());
  },
  updateTheme: (patch) => {
    set((state) => ({ theme: { ...state.theme, ...patch } }));
    scheduleSave(get().snapshot());
  },
  replace: (next) => {
    set((state) => ({ profile: normalizeProfile(next.profile), theme: normalizeTheme(next.theme, state.theme.language) }));
    scheduleSave(get().snapshot());
  },
  snapshot: () => ({ profile: get().profile, theme: get().theme }),
}));

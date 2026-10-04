import { create } from "zustand";

const SPELL_CHECK_KEY = "vivepdf.studioSpellCheck";

function readSpellCheck(): boolean {
  try {
    return localStorage.getItem(SPELL_CHECK_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeSpellCheck(value: boolean) {
  try {
    localStorage.setItem(SPELL_CHECK_KEY, value ? "1" : "0");
  } catch {
    return;
  }
}

type TextPrefsState = { spellCheck: boolean; setSpellCheck: (value: boolean) => void };

export const useTextPrefsStore = create<TextPrefsState>((set) => ({
  spellCheck: readSpellCheck(),
  setSpellCheck: (spellCheck) => {
    writeSpellCheck(spellCheck);
    set({ spellCheck });
  },
}));

import { create } from "zustand";

export const STUDIO_VIEW_KEY = "vivepdf.studioView";
export const BLEED_MM = 3;

export type StudioViewOption = "rulers" | "guides" | "margins" | "bleed" | "snap";
export type StudioViewPrefs = Record<StudioViewOption, boolean>;

export const DEFAULT_VIEW_PREFS: StudioViewPrefs = { rulers: true, guides: true, margins: true, bleed: false, snap: true };

export function readViewPrefs(): StudioViewPrefs {
  try {
    const raw = localStorage.getItem(STUDIO_VIEW_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_VIEW_PREFS };
    const stored = parsed as Partial<Record<string, unknown>>;
    const prefs = { ...DEFAULT_VIEW_PREFS };
    for (const key of Object.keys(DEFAULT_VIEW_PREFS) as StudioViewOption[]) if (typeof stored[key] === "boolean") prefs[key] = stored[key];
    return prefs;
  } catch {
    return { ...DEFAULT_VIEW_PREFS };
  }
}

function writeViewPrefs(prefs: StudioViewPrefs) {
  try {
    localStorage.setItem(STUDIO_VIEW_KEY, JSON.stringify(prefs));
  } catch {
    return;
  }
}

type ViewState = StudioViewPrefs & { toggle: (option: StudioViewOption) => void; reload: () => void };

function prefsOf(state: ViewState): StudioViewPrefs {
  return { rulers: state.rulers, guides: state.guides, margins: state.margins, bleed: state.bleed, snap: state.snap };
}

export const useViewPrefs = create<ViewState>((set, get) => ({
  ...readViewPrefs(),
  toggle: (option) => {
    const next = { ...prefsOf(get()), [option]: !get()[option] };
    set(next);
    writeViewPrefs(next);
  },
  reload: () => set(readViewPrefs()),
}));

import { create } from "zustand";
import { UI_ZOOMS, applyInterfaceScale, type UiZoom } from "@/shared/lib/uiZoom";
import type { CompressPreset } from "@/types";

export const PREFERENCES_KEY = "vivepdf.preferences";
export const UI_SCALES = [90, 100, 110, 120] as const;
export const RECENT_LIMITS = [5, 12, 25] as const;
export const OUTPUT_MODES = ["beside", "folder"] as const;
export const AFTER_OPERATIONS = ["none", "reveal", "open"] as const;
export const VIEWER_ZOOMS = ["fitWidth", "fitPage", "actual"] as const;
export const VIEWER_SCROLLS = ["vertical", "horizontal"] as const;
export const KEEP_IN_TRAY_MODES = ["auto", "always", "off"] as const;
export const COMPRESS_PROFILES: CompressPreset[] = ["light", "balanced", "strong", "extreme"];
export const DEFAULT_SELECTION_COLOR = "#FFD400";
const PREVIOUS_DEFAULT_SELECTION_COLOR = "#2196F3";
export const MAX_AUTHOR_LENGTH = 200;

export type UiScale = (typeof UI_SCALES)[number];
export type RecentLimit = (typeof RECENT_LIMITS)[number];
export type OutputMode = (typeof OUTPUT_MODES)[number];
export type AfterOperation = (typeof AFTER_OPERATIONS)[number];
export type ViewerZoom = (typeof VIEWER_ZOOMS)[number];
export type ViewerScroll = (typeof VIEWER_SCROLLS)[number];
export type KeepInTray = (typeof KEEP_IN_TRAY_MODES)[number];

export type Preferences = {
  uiScale: UiScale;
  uiZoom: UiZoom;
  reduceMotion: boolean;
  restoreSession: boolean;
  rememberRecent: boolean;
  keepHistory: boolean;
  recentLimit: RecentLimit;
  confirmClose: boolean;
  successToasts: boolean;
  outputMode: OutputMode;
  outputFolder: string;
  afterOperation: AfterOperation;
  viewerZoom: ViewerZoom;
  viewerSpread: boolean;
  viewerScroll: ViewerScroll;
  ocrLanguage: string;
  compressProfile: CompressPreset;
  searchAutoIndex: boolean;
  selectionColor: string;
  selectionToolbar: boolean;
  keepBackups: boolean;
  breachCheckOnline: boolean;
  keepInTray: KeepInTray;
  annotationAuthor: string;
};

export const DEFAULT_PREFERENCES: Preferences = {
  uiScale: 100,
  uiZoom: 1,
  reduceMotion: false,
  restoreSession: false,
  rememberRecent: true,
  keepHistory: true,
  recentLimit: 12,
  confirmClose: false,
  successToasts: true,
  outputMode: "beside",
  outputFolder: "",
  afterOperation: "none",
  viewerZoom: "fitWidth",
  viewerSpread: false,
  viewerScroll: "vertical",
  ocrLanguage: "",
  compressProfile: "balanced",
  searchAutoIndex: true,
  selectionColor: DEFAULT_SELECTION_COLOR,
  selectionToolbar: false,
  keepBackups: true,
  breachCheckOnline: false,
  keepInTray: "auto",
  annotationAuthor: "",
};

type Validator<T> = (value: unknown) => value is T;

function oneOf<T>(options: readonly T[]): Validator<T> {
  return (value): value is T => (options as readonly unknown[]).includes(value);
}

const isBoolean: Validator<boolean> = (value): value is boolean => typeof value === "boolean";
const isText: Validator<string> = (value): value is string => typeof value === "string" && value.length <= 1024;
const isAuthorName: Validator<string> = (value): value is string => typeof value === "string" && value.length <= MAX_AUTHOR_LENGTH;
const isHexColor: Validator<string> = (value): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

const VALIDATORS: { [Key in keyof Preferences]: Validator<Preferences[Key]> } = {
  uiScale: oneOf(UI_SCALES),
  uiZoom: oneOf(UI_ZOOMS),
  reduceMotion: isBoolean,
  restoreSession: isBoolean,
  rememberRecent: isBoolean,
  keepHistory: isBoolean,
  recentLimit: oneOf(RECENT_LIMITS),
  confirmClose: isBoolean,
  successToasts: isBoolean,
  outputMode: oneOf(OUTPUT_MODES),
  outputFolder: isText,
  afterOperation: oneOf(AFTER_OPERATIONS),
  viewerZoom: oneOf(VIEWER_ZOOMS),
  viewerSpread: isBoolean,
  viewerScroll: oneOf(VIEWER_SCROLLS),
  ocrLanguage: isText,
  compressProfile: oneOf(COMPRESS_PROFILES),
  searchAutoIndex: isBoolean,
  selectionColor: isHexColor,
  selectionToolbar: isBoolean,
  keepBackups: isBoolean,
  breachCheckOnline: isBoolean,
  keepInTray: oneOf(KEEP_IN_TRAY_MODES),
  annotationAuthor: isAuthorName,
};

const KEYS = Object.keys(DEFAULT_PREFERENCES) as Array<keyof Preferences>;

function sanitize(source: Partial<Record<keyof Preferences, unknown>>): Preferences {
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of KEYS) {
    const value = source[key];
    if ((VALIDATORS[key] as Validator<unknown>)(value)) (result as Record<keyof Preferences, unknown>)[key] = value;
  }
  return result;
}

function withCurrentDefaults(preferences: Preferences): Preferences {
  return preferences.selectionColor.toUpperCase() === PREVIOUS_DEFAULT_SELECTION_COLOR ? { ...preferences, selectionColor: DEFAULT_SELECTION_COLOR } : preferences;
}

export function readPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? withCurrentDefaults(sanitize(parsed as Partial<Record<keyof Preferences, unknown>>)) : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persist(preferences: Preferences) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    return;
  }
}

export function applyPreferences(preferences: Pick<Preferences, "uiScale" | "uiZoom" | "reduceMotion">) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  void applyInterfaceScale(root, preferences.uiScale, preferences.uiZoom);
  if (preferences.reduceMotion) root.dataset.reduceMotion = "true";
  else delete root.dataset.reduceMotion;
}

type PreferencesState = Preferences & {
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
};

function pick(state: PreferencesState): Preferences {
  const result = {} as Record<keyof Preferences, unknown>;
  for (const key of KEYS) result[key] = state[key];
  return result as Preferences;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...readPreferences(),
  update: (patch) => {
    const next = sanitize({ ...pick(get()), ...patch });
    persist(next);
    applyPreferences(next);
    set(next);
  },
  reset: () => {
    persist(DEFAULT_PREFERENCES);
    applyPreferences(DEFAULT_PREFERENCES);
    set(DEFAULT_PREFERENCES);
  },
}));

export function applyStoredPreferences() {
  applyPreferences(readPreferences());
}

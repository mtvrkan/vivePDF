import { create } from "zustand";
import type { ScanColorMode } from "@/types";

export type ScanProfileSettings = {
  source: "auto" | "flatbed" | "feeder";
  dpi: number;
  mode: ScanColorMode;
  sheets: number;
  duplex: boolean;
  deskew: boolean;
  despeckle: boolean;
  whiten: boolean;
  skipBlank: boolean;
  ocr: boolean;
  autoName: boolean;
};
export type ScanProfile = { id: string; name: string; settings: ScanProfileSettings };

export const SCAN_PROFILES_KEY = "vivepdf.scanProfiles";
const MAX_PROFILES = 20;
const SOURCES = ["auto", "flatbed", "feeder"];
const MODES = ["color", "gray", "bw"];

function validSettings(value: unknown): value is ScanProfileSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (
    SOURCES.includes(settings.source as string) &&
    MODES.includes(settings.mode as string) &&
    typeof settings.dpi === "number" &&
    typeof settings.sheets === "number" &&
    ["duplex", "deskew", "despeckle", "whiten", "skipBlank", "ocr", "autoName"].every((key) => typeof settings[key] === "boolean")
  );
}

export function readStored(): ScanProfile[] {
  try {
    const raw = localStorage.getItem(SCAN_PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ScanProfile => typeof item?.id === "string" && typeof item?.name === "string" && validSettings(item?.settings)).slice(0, MAX_PROFILES);
  } catch {
    return [];
  }
}

function persist(profiles: ScanProfile[]) {
  try {
    localStorage.setItem(SCAN_PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    return;
  }
}

type ScanProfilesState = {
  profiles: ScanProfile[];
  save: (name: string, settings: ScanProfileSettings) => ScanProfile;
  remove: (id: string) => void;
};

export const useScanProfilesStore = create<ScanProfilesState>((set, get) => ({
  profiles: readStored(),
  save: (name, settings) => {
    const trimmed = name.trim();
    const existing = get().profiles.find((item) => item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    const profile: ScanProfile = { id: existing?.id ?? crypto.randomUUID(), name: trimmed, settings };
    const profiles = existing ? get().profiles.map((item) => (item.id === existing.id ? profile : item)) : [...get().profiles, profile].slice(-MAX_PROFILES);
    persist(profiles);
    set({ profiles });
    return profile;
  },
  remove: (id) => {
    const profiles = get().profiles.filter((item) => item.id !== id);
    persist(profiles);
    set({ profiles });
  },
}));

import { create } from "zustand";
import { pathKey } from "@/shared/lib/paths";
import { usePreferencesStore } from "@/shared/store/preferencesStore";

const STORAGE_KEY = "vivepdf.readingPositions";
export const READING_POSITION_LIMIT = 300;

export type ReadingPosition = { page: number; savedAt: number };
export type ReadingPositions = Record<string, ReadingPosition>;

function isPosition(value: unknown): value is ReadingPosition {
  if (typeof value !== "object" || value === null) return false;
  const { page, savedAt } = value as ReadingPosition;
  return Number.isInteger(page) && page >= 1 && typeof savedAt === "number" && Number.isFinite(savedAt);
}

export function parsePositions(raw: string | null): ReadingPositions {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isPosition(value))) as ReadingPositions;
  } catch {
    return {};
  }
}

export function withPosition(positions: ReadingPositions, key: string, page: number, now: number, limit = READING_POSITION_LIMIT): ReadingPositions {
  if (positions[key]?.page === page) return positions;
  const next: ReadingPositions = { ...positions, [key]: { page, savedAt: now } };
  const keys = Object.keys(next);
  if (keys.length <= limit) return next;
  const kept = keys.sort((left, right) => next[right].savedAt - next[left].savedAt).slice(0, limit);
  return Object.fromEntries(kept.map((entry) => [entry, next[entry]]));
}

function readStored(): ReadingPositions {
  try {
    return parsePositions(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function persist(positions: ReadingPositions) {
  try {
    if (Object.keys(positions).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    return;
  }
}

type ReadingPositionState = {
  positions: ReadingPositions;
  remember: (path: string, page: number) => void;
  positionOf: (path: string) => number | null;
  clear: () => void;
};

export const useReadingPositionStore = create<ReadingPositionState>((set, get) => ({
  positions: readStored(),
  remember: (path, page) => {
    if (!path || !usePreferencesStore.getState().rememberRecent || !Number.isInteger(page) || page < 1) return;
    const positions = withPosition(get().positions, pathKey(path), page, Date.now());
    if (positions === get().positions) return;
    persist(positions);
    set({ positions });
  },
  positionOf: (path) => {
    if (!usePreferencesStore.getState().rememberRecent) return null;
    return get().positions[pathKey(path)]?.page ?? null;
  },
  clear: () => {
    persist({});
    set({ positions: {} });
  },
}));

import type { SessionSnapshot } from "@/types";

export type StartupState = { previous: SessionSnapshot | null; clean: boolean; reloaded: boolean; handled: boolean };
type OfferStorage = Pick<Storage, "getItem" | "setItem">;
export type StartupSources = {
  readPrevious: () => SessionSnapshot | null;
  readClean: () => boolean;
  readReloaded?: () => boolean;
  storage: OfferStorage | null;
  hotData: Record<string, unknown> | null;
};

export const STARTUP_OFFERED_KEY = "vivepdf.startupOffered";
const HOT_DATA_KEY = "startupState";

function wasOffered(storage: OfferStorage | null): boolean {
  try {
    return storage?.getItem(STARTUP_OFFERED_KEY) === "1";
  } catch {
    return false;
  }
}

function isStartupState(value: unknown): value is StartupState {
  return typeof value === "object" && value !== null && "handled" in value && "clean" in value;
}

export function resolveStartupState(sources: StartupSources): StartupState {
  const kept = sources.hotData?.[HOT_DATA_KEY];
  if (isStartupState(kept)) return kept;
  const previous = sources.readPrevious();
  const reloaded = sources.readReloaded?.() ?? false;
  const clean = reloaded || sources.readClean();
  const offered = !reloaded && wasOffered(sources.storage);
  const state: StartupState = { previous, clean, reloaded, handled: offered };
  if (sources.hotData) sources.hotData[HOT_DATA_KEY] = state;
  return state;
}

export function markStartupHandled(state: StartupState, storage: OfferStorage | null) {
  state.handled = true;
  try {
    storage?.setItem(STARTUP_OFFERED_KEY, "1");
  } catch {
    return;
  }
}

export function developmentSessionStorage(isDevelopment: boolean): OfferStorage | null {
  if (!isDevelopment) return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@/types";
import { STARTUP_OFFERED_KEY, developmentSessionStorage, markStartupHandled, resolveStartupState } from "./startupState";

const snapshot: SessionSnapshot = { savedAt: 1, route: "/viewer", documents: ["C:/docs/a.pdf"], activePath: null, organizer: null };

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

describe("resolveStartupState", () => {
  it("reports an unclean exit with the previous session left to the home page", () => {
    const state = resolveStartupState({ readPrevious: () => snapshot, readClean: () => false, storage: null, hotData: null });
    expect(state.clean).toBe(false);
    expect(state.previous).toBe(snapshot);
    expect(state.handled).toBe(false);
    expect(state).not.toHaveProperty("pending");
  });

  it("reports a clean exit", () => {
    expect(resolveStartupState({ readPrevious: () => snapshot, readClean: () => true, storage: null, hotData: null }).clean).toBe(true);
  });

  it("keeps the handled state when the module is re-run by hot reload", () => {
    const hotData: Record<string, unknown> = {};
    const first = resolveStartupState({ readPrevious: () => snapshot, readClean: () => false, storage: null, hotData });
    markStartupHandled(first, null);
    let reads = 0;
    const second = resolveStartupState({
      readPrevious: () => {
        reads += 1;
        return snapshot;
      },
      readClean: () => false,
      storage: null,
      hotData,
    });
    expect(second.handled).toBe(true);
    expect(second).toBe(first);
    expect(reads).toBe(0);
  });

  it("does not act again after a page reload once startup was handled", () => {
    const storage = memoryStorage();
    const first = resolveStartupState({ readPrevious: () => snapshot, readClean: () => false, storage, hotData: null });
    markStartupHandled(first, storage);
    expect(storage.entries.get(STARTUP_OFFERED_KEY)).toBe("1");
    const reloaded = resolveStartupState({ readPrevious: () => snapshot, readClean: () => false, storage, hotData: null });
    expect(reloaded.handled).toBe(true);
  });

  it("treats a page reload as clean and ignores an earlier offer so the documents come back", () => {
    const storage = memoryStorage();
    storage.setItem(STARTUP_OFFERED_KEY, "1");
    const state = resolveStartupState({ readPrevious: () => snapshot, readClean: () => false, readReloaded: () => true, storage, hotData: null });
    expect(state.reloaded).toBe(true);
    expect(state.clean).toBe(true);
    expect(state.handled).toBe(false);
    expect(state.previous).toBe(snapshot);
  });

  it("uses no storage outside development so a release launch behaves as before", () => {
    expect(developmentSessionStorage(false)).toBeNull();
  });

  it("ignores a storage that throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const state = resolveStartupState({ readPrevious: () => snapshot, readClean: () => false, storage, hotData: null });
    expect(state.handled).toBe(false);
    expect(() => markStartupHandled(state, storage)).not.toThrow();
  });
});

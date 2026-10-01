import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

let store: typeof import("./preferencesStore");

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  store = await import("./preferencesStore");
});

beforeEach(() => {
  localStorage.clear();
  store.usePreferencesStore.getState().reset();
});

describe("preferences", () => {
  it("falls back to defaults for missing, corrupt or out-of-range values", () => {
    expect(store.readPreferences()).toEqual(store.DEFAULT_PREFERENCES);
    localStorage.setItem(store.PREFERENCES_KEY, "{oops");
    expect(store.readPreferences()).toEqual(store.DEFAULT_PREFERENCES);
    localStorage.setItem(
      store.PREFERENCES_KEY,
      JSON.stringify({ uiScale: 300, reduceMotion: "yes", recentLimit: 7, outputMode: "cloud", afterOperation: "print", viewerZoom: "huge", compressProfile: "insane", keepHistory: false }),
    );
    expect(store.readPreferences()).toEqual({ ...store.DEFAULT_PREFERENCES, keepHistory: false });
  });

  it("keeps every valid value, including the new tool and output knobs", () => {
    const stored = {
      ...store.DEFAULT_PREFERENCES,
      uiScale: 110 as const,
      recentLimit: 25 as const,
      outputMode: "folder" as const,
      outputFolder: "D:/outputs",
      afterOperation: "reveal" as const,
      viewerZoom: "fitPage" as const,
      viewerSpread: true,
      ocrLanguage: "tur",
      compressProfile: "strong" as const,
      searchAutoIndex: false,
      confirmClose: true,
      successToasts: false,
    };
    localStorage.setItem(store.PREFERENCES_KEY, JSON.stringify(stored));
    expect(store.readPreferences()).toEqual(stored);
  });

  it("moves the previous blue default selection colour to the yellow one and keeps a chosen colour", () => {
    localStorage.setItem(store.PREFERENCES_KEY, JSON.stringify({ ...store.DEFAULT_PREFERENCES, selectionColor: "#2196f3" }));
    expect(store.readPreferences().selectionColor).toBe(store.DEFAULT_SELECTION_COLOR);
    localStorage.setItem(store.PREFERENCES_KEY, JSON.stringify({ ...store.DEFAULT_PREFERENCES, selectionColor: "#30a46c" }));
    expect(store.readPreferences().selectionColor).toBe("#30a46c");
  });

  it("persists partial updates and keeps the other fields", () => {
    store.usePreferencesStore.getState().update({ uiScale: 110 });
    store.usePreferencesStore.getState().update({ restoreSession: true });
    const persisted = JSON.parse(localStorage.getItem(store.PREFERENCES_KEY) ?? "{}") as Record<string, unknown>;
    expect(persisted).toEqual({ ...store.DEFAULT_PREFERENCES, uiScale: 110, restoreSession: true });
    expect(store.usePreferencesStore.getState().uiScale).toBe(110);
    expect(store.usePreferencesStore.getState().rememberRecent).toBe(true);
  });

  it("rejects an invalid patch value instead of storing it", () => {
    store.usePreferencesStore.getState().update({ outputMode: "cloud" as never });
    expect(store.usePreferencesStore.getState().outputMode).toBe("beside");
  });

  it("returns to defaults on reset", () => {
    store.usePreferencesStore.getState().update({ reduceMotion: true, keepHistory: false, outputFolder: "D:/out" });
    store.usePreferencesStore.getState().reset();
    expect(store.readPreferences()).toEqual(store.DEFAULT_PREFERENCES);
    expect(store.usePreferencesStore.getState().reduceMotion).toBe(false);
  });
});

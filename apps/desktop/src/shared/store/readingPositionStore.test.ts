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

let store: typeof import("./readingPositionStore");
let preferences: typeof import("./preferencesStore");

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  store = await import("./readingPositionStore");
  preferences = await import("./preferencesStore");
});

describe("reading positions", () => {
  beforeEach(() => {
    preferences.usePreferencesStore.setState({ rememberRecent: true });
    store.useReadingPositionStore.getState().clear();
  });

  it("remembers the last page per file regardless of slash direction and case", () => {
    const state = store.useReadingPositionStore.getState();
    state.remember(String.raw`C:\Tez\Makale.pdf`, 42);
    expect(store.useReadingPositionStore.getState().positionOf("c:/tez/makale.pdf")).toBe(42);
    expect(store.parsePositions(localStorage.getItem("vivepdf.readingPositions"))["c:/tez/makale.pdf"]?.page).toBe(42);
    expect(store.useReadingPositionStore.getState().positionOf("C:/other.pdf")).toBeNull();
  });

  it("keeps only the most recently read files and ignores corrupt storage", () => {
    let positions = {};
    for (let index = 0; index < 5; index += 1) positions = store.withPosition(positions, `f${index}`, index + 1, index, 3);
    expect(Object.keys(positions).sort()).toEqual(["f2", "f3", "f4"]);
    expect(store.withPosition(positions, "f4", 5, 99, 3)).toBe(positions);
    expect(store.parsePositions("{not json")).toEqual({});
    expect(store.parsePositions(JSON.stringify({ a: { page: 0, savedAt: 1 }, b: { page: 3, savedAt: 2 }, c: [] }))).toEqual({ b: { page: 3, savedAt: 2 } });
  });

  it("stores nothing and restores nothing while recent files are not remembered", () => {
    store.useReadingPositionStore.getState().remember("/a.pdf", 7);
    preferences.usePreferencesStore.setState({ rememberRecent: false });
    expect(store.useReadingPositionStore.getState().positionOf("/a.pdf")).toBeNull();
    store.useReadingPositionStore.getState().remember("/b.pdf", 9);
    preferences.usePreferencesStore.setState({ rememberRecent: true });
    expect(store.useReadingPositionStore.getState().positionOf("/b.pdf")).toBeNull();
    store.useReadingPositionStore.getState().clear();
    expect(store.useReadingPositionStore.getState().positionOf("/a.pdf")).toBeNull();
    expect(localStorage.getItem("vivepdf.readingPositions")).toBeNull();
  });
});

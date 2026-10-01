import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FORWARD = "C:/Users/a/doc.pdf";
const BACKWARD = String.raw`C:\Users\a\doc.pdf`;

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

let samePath: typeof import("./recentStore").samePath;
let useRecentStore: typeof import("./recentStore").useRecentStore;

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  ({ samePath, useRecentStore } = await import("./recentStore"));
});

describe("recentStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentStore.getState().clear();
  });

  it("treats forward and backward slashes as the same file", () => {
    expect(samePath(FORWARD, BACKWARD)).toBe(true);
    expect(samePath(FORWARD, "C:/Users/a/other.pdf")).toBe(false);
  });

  it("keeps one entry when the same file is added with different separators", () => {
    useRecentStore.getState().add(BACKWARD);
    useRecentStore.getState().add(FORWARD);
    expect(useRecentStore.getState().items).toHaveLength(1);
    expect(useRecentStore.getState().items[0]?.path).toBe(FORWARD);
  });

  it("removes by either separator style", () => {
    useRecentStore.getState().add(FORWARD);
    useRecentStore.getState().remove(BACKWARD);
    expect(useRecentStore.getState().items).toHaveLength(0);
  });

  it("restores a cleared list for undo, in memory and in storage", () => {
    useRecentStore.getState().add(FORWARD);
    useRecentStore.getState().add("C:/Users/a/other.pdf");
    const snapshot = useRecentStore.getState().items;
    useRecentStore.getState().clear();
    expect(useRecentStore.getState().items).toHaveLength(0);
    useRecentStore.getState().restore(snapshot);
    expect(useRecentStore.getState().items).toEqual(snapshot);
    const stored = Object.keys(localStorage).length > 0 ? localStorage.getItem(localStorage.key(0) ?? "") ?? "" : "";
    expect(stored).toContain("other.pdf");
  });
});

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
let usePreferencesStore: typeof import("./preferencesStore").usePreferencesStore;

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  ({ samePath, useRecentStore } = await import("./recentStore"));
  ({ usePreferencesStore } = await import("./preferencesStore"));
});

function paths(): string[] {
  return useRecentStore.getState().items.map((item) => item.path);
}

describe("recentStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentStore.getState().restore([]);
    usePreferencesStore.setState({ rememberRecent: true, recentLimit: 12 });
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

  it("keeps a pinned entry when the limit drops the unpinned ones", () => {
    usePreferencesStore.setState({ recentLimit: 5 });
    useRecentStore.getState().add("C:/pinned.pdf");
    useRecentStore.getState().togglePin("C:/pinned.pdf");

    for (let index = 0; index < 6; index += 1) useRecentStore.getState().add(`C:/doc-${index}.pdf`);

    expect(paths()).toContain("C:/pinned.pdf");
    expect(useRecentStore.getState().items.filter((item) => !item.pinned)).toHaveLength(5);
    expect(paths()).not.toContain("C:/doc-0.pdf");
  });

  it("clears only the unpinned entries", () => {
    useRecentStore.getState().add("C:/keep.pdf");
    useRecentStore.getState().add("C:/drop.pdf");
    useRecentStore.getState().togglePin("C:/keep.pdf");

    useRecentStore.getState().clear();

    expect(paths()).toEqual(["C:/keep.pdf"]);
    expect(localStorage.getItem("vivepdf.recent")).not.toContain("drop.pdf");
  });

  it("keeps the pin when a pinned file is opened again", () => {
    useRecentStore.getState().add(FORWARD);
    useRecentStore.getState().togglePin(FORWARD);
    useRecentStore.getState().add("C:/Users/a/other.pdf");

    useRecentStore.getState().add(BACKWARD);

    expect(useRecentStore.getState().items[0]).toMatchObject({ path: BACKWARD, pinned: true });
  });

  it("persists pinning and unpinning", () => {
    useRecentStore.getState().add(FORWARD);

    useRecentStore.getState().togglePin(BACKWARD);
    const pinned = JSON.parse(localStorage.getItem("vivepdf.recent") ?? "[]") as { pinned?: boolean }[];
    useRecentStore.getState().togglePin(FORWARD);
    const unpinned = JSON.parse(localStorage.getItem("vivepdf.recent") ?? "[]") as { pinned?: boolean }[];

    expect(pinned[0]?.pinned).toBe(true);
    expect(unpinned[0]?.pinned).toBe(false);
  });

  it("persists the sort choice and reads it back on load", async () => {
    useRecentStore.getState().setSort("folder");

    vi.resetModules();
    const reloaded = await import("./recentStore");

    expect(localStorage.getItem("vivepdf.recentSort")).toBe("folder");
    expect(reloaded.useRecentStore.getState().sort).toBe("folder");
  });

  it("falls back to the recent sort for an unknown stored value", async () => {
    localStorage.setItem("vivepdf.recentSort", "size");

    vi.resetModules();
    const reloaded = await import("./recentStore");

    expect(reloaded.useRecentStore.getState().sort).toBe("recent");
  });
});

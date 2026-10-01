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

let store: typeof import("./readingStore");

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  store = await import("./readingStore");
});

beforeEach(() => {
  localStorage.clear();
});

describe("reading settings", () => {
  it("keeps only whole, non-negative speaker choices", () => {
    localStorage.setItem("vivepdf.reading", JSON.stringify({ voiceSpeakers: { "en_GB-vctk-medium": 12, broken: -1, text: "3", half: 1.5 } }));
    expect(store.readStored().voiceSpeakers).toEqual({ "en_GB-vctk-medium": 12 });
  });

  it("starts with no speaker choices", () => {
    expect(store.readStored().voiceSpeakers).toEqual({});
    localStorage.setItem("vivepdf.reading", JSON.stringify({ voiceSpeakers: "p225" }));
    expect(store.readStored().voiceSpeakers).toEqual({});
  });

  it("turns the previous invert switch into the dark page colours and keeps a chosen scheme", () => {
    localStorage.setItem("vivepdf.reading", JSON.stringify({ invert: true }));
    expect(store.readStored().pageColors).toBe("dark");
    localStorage.setItem("vivepdf.reading", JSON.stringify({ invert: false }));
    expect(store.readStored().pageColors).toBe("normal");
    localStorage.setItem("vivepdf.reading", JSON.stringify({ pageColors: "yellowOnBlack", invert: true }));
    expect(store.readStored()).toMatchObject({ pageColors: "yellowOnBlack", lastPageColors: "yellowOnBlack" });
  });

  it("falls back to normal page colours for an unknown scheme and remembers the last one used", () => {
    localStorage.setItem("vivepdf.reading", JSON.stringify({ pageColors: "purple", lastPageColors: "sepia" }));
    expect(store.readStored()).toMatchObject({ pageColors: "normal", lastPageColors: "sepia" });
    localStorage.setItem("vivepdf.reading", JSON.stringify({ lastPageColors: "normal" }));
    expect(store.readStored().lastPageColors).toBe("dark");
  });

  it("stores a speaker choice with the other reading settings", () => {
    store.useReadingStore.getState().update({ voiceSpeakers: { "en_US-arctic-medium": 4 } });
    const saved = JSON.parse(localStorage.getItem("vivepdf.reading") ?? "{}") as { voiceSpeakers?: Record<string, number>; rate?: number };
    expect(saved.voiceSpeakers).toEqual({ "en_US-arctic-medium": 4 });
    expect(saved.rate).toBe(1);
  });
});

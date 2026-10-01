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

let utils: typeof import("./searchUtils");

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  utils = await import("./searchUtils");
});

beforeEach(() => {
  localStorage.clear();
});

describe("history", () => {
  it("keeps the newest query first, dedupes and caps the list", () => {
    for (let index = 0; index < 12; index += 1) utils.pushHistory(`q${index}`);
    utils.pushHistory("q3");
    const items = utils.readHistory();
    expect(items[0]).toBe("q3");
    expect(items).toHaveLength(utils.HISTORY_MAX);
    expect(items.filter((item) => item === "q3")).toHaveLength(1);
  });

  it("ignores blank queries and removes entries", () => {
    utils.pushHistory("   ");
    expect(utils.readHistory()).toEqual([]);
    utils.pushHistory("invoice");
    expect(utils.removeFromHistory("invoice")).toEqual([]);
    utils.pushHistory("a");
    utils.pushHistory("b");
    expect(utils.clearHistory()).toEqual([]);
    expect(utils.readHistory()).toEqual([]);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem(utils.HISTORY_KEY, "{not json");
    expect(utils.readHistory()).toEqual([]);
  });
});

describe("dates", () => {
  it("converts a day to start-of-day and end-of-day epochs", () => {
    const start = utils.dateToEpoch("2026-09-10", false) as number;
    const end = utils.dateToEpoch("2026-09-10", true) as number;
    expect(end - start).toBe(24 * 60 * 60 - 1);
  });

  it("returns undefined for empty or invalid input", () => {
    expect(utils.dateToEpoch("", false)).toBeUndefined();
    expect(utils.dateToEpoch("not-a-date", false)).toBeUndefined();
  });

  it("finds the newest index time and staleness", () => {
    const folders = [
      { path: "a", recursive: true, files: 1, pages: 1, lastIndexed: 100 },
      { path: "b", recursive: true, files: 1, pages: 1, lastIndexed: 500 },
      { path: "c", recursive: true, files: 1, pages: 1, lastIndexed: null },
    ];
    expect(utils.latestIndexedAt(folders)).toBe(500);
    expect(utils.latestIndexedAt([])).toBeNull();
    expect(utils.isIndexStale(null, 1000)).toBe(true);
    expect(utils.isIndexStale(500, 500 + utils.STALE_SECONDS - 1)).toBe(false);
    expect(utils.isIndexStale(500, 500 + utils.STALE_SECONDS)).toBe(true);
  });
});

describe("snippets", () => {
  it("marks delimited segments as matches and drops empty parts", () => {
    const parts = utils.splitSnippet("Backus-Naur \ue000Form\ue001 (BNF)");
    expect(parts).toEqual([
      { text: "Backus-Naur ", matched: false },
      { text: "Form", matched: true },
      { text: " (BNF)", matched: false },
    ]);
    expect(utils.splitSnippet("\ue000Form\ue001")).toEqual([{ text: "Form", matched: true }]);
  });
});

describe("query params", () => {
  const base = { query: "form", folder: "all", documentPath: null, modifiedAfter: "", modifiedBefore: "", minPages: "", maxPages: "" };

  it("omits unset filters", () => {
    expect(utils.buildQueryParams(base)).toEqual({ query: "form", limit: utils.RESULT_LIMIT });
  });

  it("passes folder, document and bounds through", () => {
    const params = utils.buildQueryParams({ ...base, folder: "C:/docs", documentPath: "C:/docs/a.pdf", minPages: "10", maxPages: "20" });
    expect(params.folder).toBe("C:/docs");
    expect(params.path).toBe("C:/docs/a.pdf");
    expect(params.minPages).toBe(10);
    expect(params.maxPages).toBe(20);
  });

  it("swaps inverted page and date ranges and drops negative or invalid numbers", () => {
    const params = utils.buildQueryParams({ ...base, minPages: "30", maxPages: "5", modifiedAfter: "2026-09-18", modifiedBefore: "2026-09-03" });
    expect(params.minPages).toBe(5);
    expect(params.maxPages).toBe(30);
    expect((params.modifiedAfter as number) < (params.modifiedBefore as number)).toBe(true);
    expect(utils.buildQueryParams({ ...base, minPages: "-4", maxPages: "abc" })).toEqual({ query: "form", limit: utils.RESULT_LIMIT });
  });
});

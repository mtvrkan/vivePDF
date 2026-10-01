import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let readStored: typeof import("./watchStore").readStored;
let readStoredLog: typeof import("./watchStore").readStoredLog;
let cleanFolderName: typeof import("./watchStore").cleanFolderName;
let readStoredPause: typeof import("./watchStore").readStoredPause;
let useWatchStore: typeof import("./watchStore").useWatchStore;

beforeAll(async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  });
  ({ readStored, readStoredLog, cleanFolderName, readStoredPause, useWatchStore } = await import("./watchStore"));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("readStored", () => {
  it("fills missing fields of a saved rule with safe values", () => {
    localStorage.setItem("vivepdf.watchRules", JSON.stringify([{ id: "a", folder: "C:/in", numbering: 12.7 }]));
    expect(readStored()).toEqual([{ id: "a", folder: "C:/in", chainId: null, outputDir: "", recursive: false, enabled: true, numbering: 12 }]);
  });

  it("keeps a complete rule as it was saved", () => {
    const rule = { id: "a", folder: "C:/in", chainId: "c", outputDir: "C:/out", recursive: true, enabled: false, numbering: 4 };
    localStorage.setItem("vivepdf.watchRules", JSON.stringify([rule]));
    expect(readStored()).toEqual([rule]);
  });

  it("drops rules without a folder and ignores broken storage", () => {
    localStorage.setItem("vivepdf.watchRules", JSON.stringify([{ id: "a", folder: "" }, { folder: "C:/in" }, null, { id: "b", folder: "C:/in", numbering: -3, recursive: "yes" }]));
    expect(readStored()).toEqual([{ id: "b", folder: "C:/in", chainId: null, outputDir: "", recursive: false, enabled: true, numbering: 0 }]);
    localStorage.setItem("vivepdf.watchRules", "{not json");
    expect(readStored()).toEqual([]);
  });
});

describe("sorting folders on a rule", () => {
  it("keeps the move and catch-up options and cleans the folder names", () => {
    localStorage.setItem("vivepdf.watchRules", JSON.stringify([{ id: "a", folder: "C:/in", moveSources: true, processedName: " Done/ ", failedName: "..", catchUp: true }]));
    expect(readStored()[0]).toMatchObject({ moveSources: true, processedName: "Done", catchUp: true });
    expect(readStored()[0].failedName).toBeUndefined();
  });

  it("strips characters a folder name cannot hold", () => {
    expect(cleanFolderName("İş<le>ndi?\u0007. ")).toBe("İşlendi");
    expect(cleanFolderName("   ")).toBe("");
  });
});

describe("readStoredLog", () => {
  it("brings back finished entries and marks unfinished ones as interrupted", () => {
    localStorage.setItem(
      "vivepdf.watchLog",
      JSON.stringify([
        { id: "1", path: "C:/in/a.pdf", status: "running", at: 5, ruleId: "a" },
        { id: "2", path: "C:/in/b.pdf", status: "done", at: 4, output: "C:/out/b.pdf", movedTo: "C:/in/Done/b.pdf" },
      ]),
    );
    expect(readStoredLog()).toEqual([
      { id: "1", path: "C:/in/a.pdf", status: "cancelled", at: 5, ruleId: "a", interrupted: true },
      { id: "2", path: "C:/in/b.pdf", status: "done", at: 4, output: "C:/out/b.pdf", movedTo: "C:/in/Done/b.pdf" },
    ]);
  });

  it("drops malformed entries and ignores broken storage", () => {
    localStorage.setItem("vivepdf.watchLog", JSON.stringify([{ id: "1", path: "C:/a.pdf", status: "exploded", at: 1 }, { id: "2", status: "done", at: 1 }, null]));
    expect(readStoredLog()).toEqual([]);
    localStorage.setItem("vivepdf.watchLog", "{not json");
    expect(readStoredLog()).toEqual([]);
  });
});

describe("pausing", () => {
  it("remembers when watching was paused and forgets it on resume", () => {
    useWatchStore.getState().setPaused(true);
    const pausedAt = useWatchStore.getState().pausedAt;
    expect(pausedAt).toBeGreaterThan(0);
    expect(readStoredPause()).toBe(pausedAt);
    useWatchStore.getState().setPaused(true);
    expect(useWatchStore.getState().pausedAt).toBe(pausedAt);
    useWatchStore.getState().setPaused(false);
    expect(useWatchStore.getState().pausedAt).toBeNull();
    expect(readStoredPause()).toBeNull();
  });

  it("ignores a broken stored pause", () => {
    localStorage.setItem("vivepdf.watchPausedAt", "soon");
    expect(readStoredPause()).toBeNull();
    localStorage.setItem("vivepdf.watchPausedAt", "-5");
    expect(readStoredPause()).toBeNull();
  });
});

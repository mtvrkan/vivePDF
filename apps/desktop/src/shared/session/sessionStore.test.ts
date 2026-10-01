import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@/types";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const snapshot: SessionSnapshot = {
  savedAt: 1,
  route: "/viewer",
  documents: ["C:/docs/a.pdf"],
  activePath: "C:/docs/a.pdf",
  organizer: null,
};

async function loadStore() {
  vi.resetModules();
  return import("./sessionStore");
}

const entries = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => {
    entries.set(key, value);
  },
  removeItem: (key: string) => {
    entries.delete(key);
  },
  clear: () => {
    entries.clear();
  },
});

describe("sessionStore", () => {
  beforeEach(() => {
    entries.clear();
    invoke.mockReset();
  });

  it("captures the startup snapshot before anything overwrites it", async () => {
    entries.set("vivepdf.session", JSON.stringify(snapshot));
    const store = await loadStore();
    store.writeSession(null);
    expect(store.readSession()).toBeNull();
    expect(store.readStartupSession()).toEqual(snapshot);
  });

  it("reports no startup snapshot when storage is empty", async () => {
    const store = await loadStore();
    expect(store.readStartupSession()).toBeNull();
  });

  it("ignores a stored snapshot without a documents array", async () => {
    entries.set("vivepdf.session", JSON.stringify({ savedAt: 1, route: "/" }));
    const store = await loadStore();
    expect(store.readStartupSession()).toBeNull();
  });

  it("treats a missing clean-exit marker as a clean exit", async () => {
    const store = await loadStore();
    expect(store.wasCleanExit()).toBe(true);
    store.markSessionRunning();
    expect(store.wasCleanExit()).toBe(false);
    store.markCleanExit();
    expect(store.wasCleanExit()).toBe(true);
  });

  it("marks a page reload as a clean exit and reports it only once", async () => {
    const tab = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => tab.get(key) ?? null,
      setItem: (key: string, value: string) => void tab.set(key, value),
      removeItem: (key: string) => void tab.delete(key),
    });
    const store = await loadStore();
    store.markSessionRunning();
    expect(store.consumePageReload()).toBe(false);
    store.markPageReload();
    expect(store.wasCleanExit()).toBe(true);
    expect(store.consumePageReload()).toBe(true);
    expect(store.consumePageReload()).toBe(false);
  });

  it("treats a blocked tab storage as no reload", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    });
    const store = await loadStore();
    expect(() => store.markPageReload()).not.toThrow();
    expect(store.consumePageReload()).toBe(false);
  });

  it("restores from the app-data file when the WebView storage was wiped", async () => {
    invoke.mockResolvedValue(JSON.stringify(snapshot));
    const store = await loadStore();
    expect(store.readStartupSession()).toBeNull();
    await store.loadSessionFile();
    expect(invoke).toHaveBeenCalledWith("session_read");
    expect(store.readStartupSession()).toEqual(snapshot);
    expect(store.readSession()).toEqual(snapshot);
  });

  it("prefers whichever copy was saved last", async () => {
    const later = { ...snapshot, savedAt: 5, documents: ["C:/docs/b.pdf"] };
    entries.set("vivepdf.session", JSON.stringify(later));
    invoke.mockResolvedValue(JSON.stringify(snapshot));
    const store = await loadStore();
    await store.loadSessionFile();
    expect(store.readStartupSession()).toEqual(later);
  });

  it("writes every change to the file in order and clears it with the mirror", async () => {
    invoke.mockResolvedValue(undefined);
    const store = await loadStore();
    store.writeSession(snapshot);
    store.writeSession(null);
    await store.settledSessionWrites();
    expect(invoke.mock.calls).toEqual([
      ["session_write", { contents: JSON.stringify(snapshot) }],
      ["session_write", { contents: null }],
    ]);
    expect(entries.has("vivepdf.session")).toBe(false);
    expect(store.readSession()).toBeNull();
  });

  it("keeps working when the file cannot be read or written", async () => {
    invoke.mockRejectedValue(new Error("no app data dir"));
    entries.set("vivepdf.session", JSON.stringify(snapshot));
    const store = await loadStore();
    await store.loadSessionFile();
    expect(store.readStartupSession()).toEqual(snapshot);
    store.writeSession(null);
    await expect(store.settledSessionWrites()).resolves.toBeUndefined();
    expect(store.readSession()).toBeNull();
  });

  it("does not let a late file read undo a write made this run", async () => {
    let release: (value: string) => void = () => undefined;
    invoke.mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)));
    const store = await loadStore();
    const loading = store.loadSessionFile();
    store.writeSession(null);
    release(JSON.stringify(snapshot));
    await loading;
    expect(store.readSession()).toBeNull();
  });
});

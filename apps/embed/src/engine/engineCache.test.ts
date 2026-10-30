import { describe, expect, it, vi } from "vitest";
import { cachedEngineUrl } from "./engineCache";

const ENGINE = "https://cdn.example.net/vivepdf/pdfium.wasm";

function fakeStorage(entries: Record<string, Record<string, Response>> = {}) {
  const store = new Map(Object.entries(entries).map(([name, items]) => [name, new Map(Object.entries(items))]));
  const storage = {
    open: vi.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const items = store.get(name)!;
      return { match: async (key: string) => items.get(key)?.clone(), put: async (key: string, value: Response) => void items.set(key, value) };
    }),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  return { storage: storage as unknown as CacheStorage, store };
}

function dependencies(storage: CacheStorage | undefined, download = vi.fn(async () => new Response(new Uint8Array([0, 97, 115, 109])))) {
  return { storage, download, objectUrl: vi.fn(() => "blob:https://example.com/engine"), revoke: vi.fn(), readable: vi.fn(async () => true) };
}

describe("cachedEngineUrl", () => {
  it("downloads the engine once, keeps it and hands out a blob address", async () => {
    const { storage, store } = fakeStorage();
    const deps = dependencies(storage);

    const first = await cachedEngineUrl(ENGINE, "abc123", deps);
    const second = await cachedEngineUrl(ENGINE, "abc123", deps);

    expect([first.url, second.url]).toEqual(["blob:https://example.com/engine", "blob:https://example.com/engine"]);
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(store.get("vivepdf-engine-abc123")?.has(ENGINE)).toBe(true);
  });

  it("drops the engine kept for an older build", async () => {
    const { storage, store } = fakeStorage({ "vivepdf-engine-old": { [ENGINE]: new Response("old") }, "site-cache": {} });

    await cachedEngineUrl(ENGINE, "new", dependencies(storage));
    await vi.waitFor(() => expect([...store.keys()].sort()).toEqual(["site-cache", "vivepdf-engine-new"]));
  });

  it("uses the plain address without Cache Storage or when the download fails", async () => {
    const { storage } = fakeStorage();
    const failing = dependencies(storage, vi.fn(async () => new Response("missing", { status: 404 })));

    const results = [await cachedEngineUrl(ENGINE, "abc123", dependencies(undefined)), await cachedEngineUrl(ENGINE, "abc123", failing)];

    expect(results.map((result) => result.url)).toEqual([ENGINE, ENGINE]);
  });

  it("falls back to the plain address when the page may not read blob addresses", async () => {
    const { storage } = fakeStorage();
    const deps = { ...dependencies(storage), readable: vi.fn(async () => false) };

    const engine = await cachedEngineUrl(ENGINE, "abc123", deps);

    expect(engine.url).toBe(ENGINE);
    expect(deps.revoke).toHaveBeenCalledWith("blob:https://example.com/engine");
  });

  it("releases the blob address it made", async () => {
    const { storage } = fakeStorage();
    const deps = dependencies(storage);

    const engine = await cachedEngineUrl(ENGINE, "abc123", deps);
    engine.release();

    expect(deps.revoke).toHaveBeenCalledWith("blob:https://example.com/engine");
  });
});

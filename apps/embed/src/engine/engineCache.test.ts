import { describe, expect, it, vi } from "vitest";
import { fetchEngine, installEngineCache } from "./engineCache";

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

const wasm = () => new Response(new Uint8Array([0, 97, 115, 109]), { headers: { "content-type": "application/wasm" } });

describe("fetchEngine", () => {
  it("downloads the engine once and answers later loads from Cache Storage", async () => {
    const { storage, store } = fakeStorage();
    const download = vi.fn(async () => wasm());

    const first = await fetchEngine(ENGINE, "abc123", storage, download);
    await vi.waitFor(() => expect(store.get("vivepdf-engine-abc123")?.has(ENGINE)).toBe(true));
    const second = await fetchEngine(ENGINE, "abc123", storage, download);

    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([0, 97, 115, 109]);
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([0, 97, 115, 109]);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("drops the engine kept for an older build", async () => {
    const { storage, store } = fakeStorage({ "vivepdf-engine-old": { [ENGINE]: new Response("old") }, "site-cache": {} });

    await fetchEngine(ENGINE, "new", storage, async () => wasm());

    await vi.waitFor(() => expect([...store.keys()].sort()).toEqual(["site-cache", "vivepdf-engine-new"]));
  });

  it("downloads without keeping anything when Cache Storage is missing, broken or the download fails", async () => {
    const { storage, store } = fakeStorage();
    const broken = { open: async () => Promise.reject(new Error("quota")) } as unknown as CacheStorage;
    const missing = async () => new Response("missing", { status: 404 });

    const statuses = [
      (await fetchEngine(ENGINE, "abc123", undefined, async () => wasm())).status,
      (await fetchEngine(ENGINE, "abc123", broken, async () => wasm())).status,
      (await fetchEngine(ENGINE, "abc123", storage, missing)).status,
    ];

    expect(statuses).toEqual([200, 200, 404]);
    expect(store.get("vivepdf-engine-abc123")?.size ?? 0).toBe(0);
  });
});

describe("installEngineCache", () => {
  it("sends only the engine file through the cache and leaves other requests alone", async () => {
    const { storage, store } = fakeStorage();
    const network = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith(".wasm") ? wasm() : new Response("pdf")));
    const scope = { fetch: network as unknown as typeof fetch, caches: storage };

    installEngineCache(scope, "abc123");
    await scope.fetch(ENGINE);
    await scope.fetch("https://example.com/files/report.pdf");

    await vi.waitFor(() => expect([...(store.get("vivepdf-engine-abc123")?.keys() ?? [])]).toEqual([ENGINE]));
    expect(network.mock.calls.map(([input]) => String(input))).toEqual([ENGINE, "https://example.com/files/report.pdf"]);
  });

  it("caches only the engine the worker loaded first, not another file of the same name", async () => {
    const { storage, store } = fakeStorage();
    const network = vi.fn(async () => wasm());
    const scope = { fetch: network as unknown as typeof fetch, caches: storage };
    const other = "https://other.example/fonts/pdfium.wasm";

    installEngineCache(scope, "abc123");
    await scope.fetch(ENGINE);
    await scope.fetch(other);

    await vi.waitFor(() => expect([...(store.get("vivepdf-engine-abc123")?.keys() ?? [])]).toEqual([ENGINE]));
    expect(network).toHaveBeenCalledTimes(2);
  });
});

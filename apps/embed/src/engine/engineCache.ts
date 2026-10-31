const CACHE_PREFIX = "vivepdf-engine-";
const ENGINE_FILE = /\/pdfium\.wasm(?:[?#]|$)/;

type Download = (url: string) => Promise<Response>;
type EngineScope = { fetch: typeof fetch; caches?: CacheStorage };

async function pruneOlder(storage: CacheStorage, current: string): Promise<void> {
  const names = await storage.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current).map((name) => storage.delete(name)));
}

export async function fetchEngine(url: string, build: string, storage: CacheStorage | undefined, download: Download): Promise<Response> {
  if (!storage) return download(url);
  const name = CACHE_PREFIX + build;
  let cache: Cache;
  try {
    cache = await storage.open(name);
    const kept = await cache.match(url);
    if (kept) return kept;
  } catch {
    return download(url);
  }
  const fresh = await download(url);
  if (fresh.ok)
    void cache
      .put(url, fresh.clone())
      .then(() => pruneOlder(storage, name))
      .catch(() => {});
  return fresh;
}

export function installEngineCache(scope: EngineScope, build: string): void {
  const network = scope.fetch.bind(scope);
  let engineUrl: string | null = null;
  scope.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : null;
    if (url !== null && engineUrl === null && ENGINE_FILE.test(url)) engineUrl = url;
    if (url === null || url !== engineUrl) return network(input, init);
    return fetchEngine(url, build, scope.caches, (target) => network(target, init));
  };
}

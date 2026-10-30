export type CachedEngine = { url: string; release: () => void };

const CACHE_PREFIX = "vivepdf-engine-";

type Dependencies = {
  storage: CacheStorage | undefined;
  download: (url: string) => Promise<Response>;
  objectUrl: (blob: Blob) => string;
  revoke: (url: string) => void;
  readable: (url: string) => Promise<boolean>;
};

const browser: Dependencies = {
  storage: typeof caches === "undefined" ? undefined : caches,
  download: (url) => fetch(url),
  objectUrl: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
  readable: (url) =>
    fetch(url).then(
      (response) => {
        void response.body?.cancel();
        return response.ok;
      },
      () => false,
    ),
};

async function pruneOlder(storage: CacheStorage, current: string): Promise<void> {
  const names = await storage.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current).map((name) => storage.delete(name)));
}

export async function cachedEngineUrl(url: string, build: string, deps: Dependencies = browser): Promise<CachedEngine> {
  const direct = { url, release: () => {} };
  if (!deps.storage) return direct;
  try {
    const name = CACHE_PREFIX + build;
    const cache = await deps.storage.open(name);
    let response = await cache.match(url);
    if (!response) {
      const fresh = await deps.download(url);
      if (!fresh.ok) return direct;
      await cache.put(url, fresh.clone());
      void pruneOlder(deps.storage, name).catch(() => {});
      response = fresh;
    }
    const blob = new Blob([await response.arrayBuffer()], { type: "application/wasm" });
    const objectUrl = deps.objectUrl(blob);
    if (!(await deps.readable(objectUrl))) {
      deps.revoke(objectUrl);
      return direct;
    }
    return { url: objectUrl, release: () => deps.revoke(objectUrl) };
  } catch {
    return direct;
  }
}

export type BlobCache = {
  recall: (key: string) => string | null;
  remember: (key: string, url: string) => void;
  retain: (key: string) => void;
  release: (key: string) => void;
  forget: (prefix: string) => number;
  size: () => number;
};

export function createBlobCache(limit: number, revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)): BlobCache {
  const entries = new Map<string, string>();
  const onScreen = new Map<string, number>();

  return {
    recall(key) {
      const url = entries.get(key);
      if (!url) return null;
      entries.delete(key);
      entries.set(key, url);
      return url;
    },
    remember(key, url) {
      entries.set(key, url);
      if (entries.size <= limit) return;
      for (const candidate of [...entries.keys()]) {
        if (entries.size <= limit) break;
        if (onScreen.has(candidate) || candidate === key) continue;
        const stale = entries.get(candidate);
        entries.delete(candidate);
        if (stale) revoke(stale);
      }
    },
    retain(key) {
      onScreen.set(key, (onScreen.get(key) ?? 0) + 1);
    },
    release(key) {
      const remaining = (onScreen.get(key) ?? 1) - 1;
      if (remaining > 0) onScreen.set(key, remaining);
      else onScreen.delete(key);
    },
    forget(prefix) {
      let removed = 0;
      for (const [key, url] of [...entries]) {
        if (!key.startsWith(prefix)) continue;
        entries.delete(key);
        revoke(url);
        removed += 1;
      }
      return removed;
    },
    size: () => entries.size,
  };
}

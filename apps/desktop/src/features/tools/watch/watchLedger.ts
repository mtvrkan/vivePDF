import { normalizePath } from "./pathRelation";

export type WatchFileEvent = { id: string; path: string; size?: number; modified?: number };

export const LEDGER_LIMIT = 2000;
const LEDGER_STORAGE_KEY = "vivepdf.watchProcessed";

export type LedgerStorage = { load: () => Array<[string, string]>; save: (entries: Array<[string, string]>) => void };

export const localLedgerStorage: LedgerStorage = {
  load: () => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(LEDGER_STORAGE_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is [string, string] => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && typeof item[1] === "string");
    } catch {
      return [];
    }
  },
  save: (entries) => {
    try {
      localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      return;
    }
  },
};

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : path;
}

function remember<V>(map: Map<string, V>, key: string, value: V, limit: number) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

export function signatureOf(event: WatchFileEvent): string | null {
  if (!event.size || !event.modified) return null;
  return `${event.size}:${event.modified}`;
}

export type WatchLedger = {
  alreadyDone: (ruleId: string, event: WatchFileEvent) => boolean;
  markDone: (ruleId: string, event: WatchFileEvent) => void;
  lineageOf: (path: string) => string[];
  loops: (ruleId: string, path: string) => boolean;
  recordOutput: (ruleId: string, source: string, output: string) => void;
};

export function createWatchLedger(limit: number = LEDGER_LIMIT, storage?: LedgerStorage): WatchLedger {
  const processed = new Map<string, string>((storage?.load() ?? []).slice(-limit));
  const lineage = new Map<string, string[]>();
  const fileKey = (ruleId: string, path: string) => `${ruleId}|${normalizePath(path)}`;
  const lineageOf = (path: string) => {
    const normalized = normalizePath(path);
    return lineage.get(normalized) ?? lineage.get(parentOf(normalized)) ?? [];
  };
  return {
    alreadyDone: (ruleId, event) => {
      const signature = signatureOf(event);
      return signature !== null && processed.get(fileKey(ruleId, event.path)) === signature;
    },
    markDone: (ruleId, event) => {
      const signature = signatureOf(event);
      if (signature === null) return;
      remember(processed, fileKey(ruleId, event.path), signature, limit);
      storage?.save(Array.from(processed.entries()));
    },
    lineageOf,
    loops: (ruleId, path) => lineageOf(path).includes(ruleId),
    recordOutput: (ruleId, source, output) => {
      const chain = lineageOf(source).filter((id) => id !== ruleId);
      remember(lineage, normalizePath(output), [...chain, ruleId], limit);
    },
  };
}

export function createFailureBatcher(flush: (names: string[]) => void, delay = 1500) {
  let names: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    add: (name: string) => {
      names.push(name);
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const batch = names;
        names = [];
        flush(batch);
      }, delay);
    },
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      names = [];
    },
  };
}

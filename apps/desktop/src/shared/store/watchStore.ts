import { create } from "zustand";

const STORAGE_KEY = "vivepdf.watchRules";
const LOG_STORAGE_KEY = "vivepdf.watchLog";
const PAUSED_STORAGE_KEY = "vivepdf.watchPausedAt";
const MAX_LOG = 200;
const MAX_FOLDER_NAME = 60;
const LOG_STATUSES = ["queued", "running", "done", "error", "cancelled"] as const;

export type WatchRule = {
  id: string;
  folder: string;
  chainId: string | null;
  outputDir: string;
  recursive: boolean;
  enabled: boolean;
  numbering?: number;
  moveSources?: boolean;
  processedName?: string;
  failedName?: string;
  catchUp?: boolean;
};

export type WatchLogStatus = (typeof LOG_STATUSES)[number];

export type WatchRuleProblem = "folderMissing" | "outputMissing" | "failed";

export type WatchLogEntry = {
  id: string;
  path: string;
  status: WatchLogStatus;
  output?: string;
  error?: string;
  at: number;
  ruleId?: string;
  movedTo?: string;
  interrupted?: boolean;
};

function folderName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[<>:"/\\|?*]/g, "").split("").filter((character) => character.charCodeAt(0) >= 32).join("").trim().replace(/[. ]+$/, "").slice(0, MAX_FOLDER_NAME);
  return cleaned && cleaned !== ".." ? cleaned : undefined;
}

export function cleanFolderName(value: string): string {
  return folderName(value) ?? "";
}

function sanitizeRule(item: unknown): WatchRule | null {
  if (typeof item !== "object" || item === null) return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.folder !== "string" || !raw.folder) return null;
  const numbering = typeof raw.numbering === "number" && Number.isFinite(raw.numbering) && raw.numbering > 0 ? Math.floor(raw.numbering) : 0;
  return {
    id: raw.id,
    folder: raw.folder,
    chainId: typeof raw.chainId === "string" ? raw.chainId : null,
    outputDir: typeof raw.outputDir === "string" ? raw.outputDir : "",
    recursive: raw.recursive === true,
    enabled: raw.enabled !== false,
    numbering,
    ...(raw.moveSources === true ? { moveSources: true } : {}),
    ...(folderName(raw.processedName) ? { processedName: folderName(raw.processedName) } : {}),
    ...(folderName(raw.failedName) ? { failedName: folderName(raw.failedName) } : {}),
    ...(raw.catchUp === true ? { catchUp: true } : {}),
  };
}

function sanitizeLogEntry(item: unknown): WatchLogEntry | null {
  if (typeof item !== "object" || item === null) return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.path !== "string" || typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null;
  const status = LOG_STATUSES.find((value) => value === raw.status);
  if (!status) return null;
  const unfinished = status === "queued" || status === "running";
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  return {
    id: raw.id,
    path: raw.path,
    status: unfinished ? "cancelled" : status,
    output: text(raw.output),
    error: unfinished ? undefined : text(raw.error),
    at: raw.at,
    ruleId: text(raw.ruleId),
    movedTo: text(raw.movedTo),
    interrupted: unfinished || raw.interrupted === true || undefined,
  };
}

export function readStoredLog(): WatchLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeLogEntry).filter((entry): entry is WatchLogEntry => entry !== null).slice(0, MAX_LOG);
  } catch {
    return [];
  }
}

function persistLog(log: WatchLogEntry[]) {
  try {
    if (log.length === 0) localStorage.removeItem(LOG_STORAGE_KEY);
    else localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(log));
  } catch {
    return;
  }
}

export function readStored(): WatchRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeRule).filter((rule): rule is WatchRule => rule !== null);
  } catch {
    return [];
  }
}

export function readStoredPause(): number | null {
  try {
    const raw = localStorage.getItem(PAUSED_STORAGE_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistPause(pausedAt: number | null) {
  try {
    if (pausedAt === null) localStorage.removeItem(PAUSED_STORAGE_KEY);
    else localStorage.setItem(PAUSED_STORAGE_KEY, String(pausedAt));
  } catch {
    return;
  }
}

function persist(rules: WatchRule[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    return;
  }
}

type WatchState = {
  rules: WatchRule[];
  log: WatchLogEntry[];
  problems: Record<string, WatchRuleProblem>;
  pausedAt: number | null;
  setPaused: (paused: boolean) => void;
  setProblem: (id: string, problem: WatchRuleProblem | null) => void;
  add: (rule: WatchRule) => void;
  update: (id: string, patch: Partial<WatchRule>) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  logEvent: (entry: WatchLogEntry) => void;
  clearLog: () => void;
  clearRules: () => void;
};

export const useWatchStore = create<WatchState>((set) => ({
  rules: readStored(),
  log: readStoredLog(),
  problems: {},
  pausedAt: readStoredPause(),
  setPaused: (paused) =>
    set((state) => {
      if ((state.pausedAt !== null) === paused) return state;
      const pausedAt = paused ? Date.now() : null;
      persistPause(pausedAt);
      return { pausedAt };
    }),
  setProblem: (id, problem) =>
    set((state) => {
      if ((state.problems[id] ?? null) === problem) return state;
      const problems = { ...state.problems };
      if (problem) problems[id] = problem;
      else delete problems[id];
      return { problems };
    }),
  add: (rule) =>
    set((state) => {
      const rules = [...state.rules, rule];
      persist(rules);
      return { rules };
    }),
  update: (id, patch) =>
    set((state) => {
      const rules = state.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule));
      persist(rules);
      return { rules };
    }),
  remove: (id) =>
    set((state) => {
      const rules = state.rules.filter((rule) => rule.id !== id);
      persist(rules);
      return { rules };
    }),
  toggle: (id) =>
    set((state) => {
      const rules = state.rules.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
      persist(rules);
      return { rules };
    }),
  logEvent: (entry) =>
    set((state) => {
      const previous = state.log.find((item) => item.id === entry.id);
      const merged = previous ? { ...previous, ...entry } : entry;
      const log = [merged, ...state.log.filter((item) => item.id !== entry.id)].slice(0, MAX_LOG);
      persistLog(log);
      return { log };
    }),
  clearLog: () => {
    persistLog([]);
    set({ log: [] });
  },
  clearRules: () => {
    persist([]);
    persistPause(null);
    set({ rules: [], pausedAt: null });
  },
}));

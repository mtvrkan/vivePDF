import type { SearchFolder, SearchQueryParams } from "@/types";

export const HISTORY_KEY = "vivepdf.searchHistory";
export const HISTORY_MAX = 10;
export const STALE_SECONDS = 10 * 60;
export const RESULT_LIMIT = 40;

const SNIPPET_DELIMITERS = /[]/;

export type SnippetPart = { text: string; matched: boolean };

export type QueryFilters = {
  query: string;
  folder: string;
  documentPath: string | null;
  modifiedAfter: string;
  modifiedBefore: string;
  minPages: string;
  maxPages: string;
};

export function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writeHistory(items: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    return;
  }
}

export function pushHistory(query: string): string[] {
  const trimmed = query.trim();
  const current = readHistory();
  if (!trimmed) return current;
  const next = [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, HISTORY_MAX);
  writeHistory(next);
  return next;
}

export function clearHistory(): string[] {
  writeHistory([]);
  return [];
}

export function removeFromHistory(query: string): string[] {
  const next = readHistory().filter((item) => item !== query);
  writeHistory(next);
  return next;
}

export function dateToEpoch(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime() / 1000;
}

export function latestIndexedAt(folders: SearchFolder[]): number | null {
  return folders.reduce<number | null>((latest, folder) => (folder.lastIndexed && (!latest || folder.lastIndexed > latest) ? folder.lastIndexed : latest), null);
}

export function isIndexStale(newest: number | null, nowSeconds: number): boolean {
  return !newest || nowSeconds - newest >= STALE_SECONDS;
}

export function splitSnippet(snippet: string): SnippetPart[] {
  return snippet
    .split(SNIPPET_DELIMITERS)
    .map((text, index) => ({ text, matched: index % 2 === 1 }))
    .filter((part) => part.text.length > 0);
}

function pageBound(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export function buildQueryParams(filters: QueryFilters): SearchQueryParams {
  let minPages = pageBound(filters.minPages);
  let maxPages = pageBound(filters.maxPages);
  if (minPages !== undefined && maxPages !== undefined && minPages > maxPages) [minPages, maxPages] = [maxPages, minPages];
  let modifiedAfter = dateToEpoch(filters.modifiedAfter, false);
  let modifiedBefore = dateToEpoch(filters.modifiedBefore, true);
  if (modifiedAfter !== undefined && modifiedBefore !== undefined && modifiedAfter > modifiedBefore) {
    [modifiedAfter, modifiedBefore] = [dateToEpoch(filters.modifiedBefore, false), dateToEpoch(filters.modifiedAfter, true)];
  }
  return {
    query: filters.query,
    limit: RESULT_LIMIT,
    folder: filters.folder === "all" ? undefined : filters.folder,
    path: filters.documentPath ?? undefined,
    modifiedAfter,
    modifiedBefore,
    minPages,
    maxPages,
  };
}

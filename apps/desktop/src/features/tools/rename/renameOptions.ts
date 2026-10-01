import type { RenameApplyParams, RenameApplyResult, RenameItem, RenameUndoParams } from "@/types";

export const SORT_KEYS = ["added", "name", "modified", "size", "pages"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const CONFLICT_POLICIES = ["number", "skip", "overwrite"] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

export const PRESETS = [
  { id: "dateTitle", pattern: "{date} {title}" },
  { id: "invoice", pattern: "{date} {invoice} {amount}" },
  { id: "numbered", pattern: "{n} {name}" },
  { id: "byYear", pattern: "{year}/{date} {title}" },
  { id: "byAuthor", pattern: "{author}/{title}" },
] as const;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function sortValue(item: RenameItem | undefined, key: Exclude<SortKey, "added" | "name">): number | null {
  if (!item || item.error) return null;
  if (key === "modified") return item.modified || null;
  if (key === "size") return item.bytes || null;
  const pages = Number(item.fields.pages);
  return Number.isFinite(pages) && pages > 0 ? pages : null;
}

export function sortPaths(paths: string[], byPath: ReadonlyMap<string, RenameItem>, key: SortKey, descending: boolean): string[] {
  if (key === "added") return descending ? [...paths].reverse() : paths;
  const direction = descending ? -1 : 1;
  const indexed = paths.map((path, index) => ({ path, index }));
  indexed.sort((left, right) => {
    if (key === "name") return direction * collator.compare(fileName(left.path), fileName(right.path)) || left.index - right.index;
    const a = sortValue(byPath.get(left.path), key);
    const b = sortValue(byPath.get(right.path), key);
    if (a === null && b === null) return left.index - right.index;
    if (a === null) return 1;
    if (b === null) return -1;
    return direction * (a - b) || left.index - right.index;
  });
  return indexed.map((entry) => entry.path);
}

export function policyParams(policy: ConflictPolicy): Pick<RenameApplyParams, "autoUnique" | "overwrite"> {
  if (policy === "skip") return { autoUnique: false, overwrite: false };
  if (policy === "overwrite") return { autoUnique: false, overwrite: true };
  return { autoUnique: true, overwrite: false };
}

export function undoPlan(result: RenameApplyResult): RenameUndoParams | null {
  const items = result.results.filter((entry) => entry.ok && entry.output && entry.output !== entry.path).map((entry) => ({ path: entry.output as string, original: entry.path }));
  if (items.length === 0) return null;
  return { items, removeDirs: result.createdDirs };
}

export function extensionOf(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

export function failureKey(error: string | null): string {
  if (error === "EXISTS") return "tools.rename.failure.exists";
  if (error === "FILE_NOT_FOUND") return "errors.FILE_NOT_FOUND";
  if (error === "INVALID_PARAMS") return "tools.rename.failure.invalid";
  return "tools.rename.failure.other";
}

export function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

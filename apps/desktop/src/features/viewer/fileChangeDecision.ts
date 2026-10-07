import { pathKey } from "@/shared/lib/paths";
import { isPdfPath } from "@/shared/rpc/files";

export type DocumentFileChanged = { path: string; exists: boolean };

export type FileChangeAction = "reload" | "stale" | "conflict" | "missing" | "changed";

export function fileChangeAction(input: { exists: boolean; unsaved: boolean; reloadOnChange: boolean; active: boolean }): FileChangeAction {
  if (!input.exists) return "missing";
  if (input.unsaved) return "conflict";
  if (!input.reloadOnChange) return "changed";
  return input.active ? "reload" : "stale";
}

export function watchablePaths(paths: string[], isConvertedCopy: (path: string) => boolean): Map<string, string> {
  const watched = new Map<string, string>();
  for (const path of paths) {
    if (!isPdfPath(path) || isConvertedCopy(path)) continue;
    const key = pathKey(path);
    if (!watched.has(key)) watched.set(key, path);
  }
  return watched;
}

import { invoke } from "@tauri-apps/api/core";

export type PathRelation = { same: boolean; inside: boolean };

export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
}

export function relationKey(folder: string, outputDir: string): string {
  return `${folder}\n${outputDir}`;
}

export function outputClashes(folder: string, outputDir: string, resolved: { key: string; relation: PathRelation } | null): boolean {
  if (resolved && resolved.key === relationKey(folder, outputDir)) return resolved.relation.same;
  return normalizePath(outputDir) === normalizePath(folder);
}

export async function resolvePathRelation(path: string, base: string): Promise<PathRelation> {
  try {
    return await invoke<PathRelation>("watch_path_relation", { path, base });
  } catch {
    return { same: normalizePath(path) === normalizePath(base), inside: false };
  }
}

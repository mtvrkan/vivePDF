import { invoke } from "@tauri-apps/api/core";
import { extensionOf } from "./paths";

export type PathKind = "file" | "directory" | "missing";

function guessedKind(path: string): PathKind {
  return extensionOf(path) === "" ? "directory" : "file";
}

export async function pathKinds(paths: string[]): Promise<PathKind[]> {
  if (paths.length === 0) return [];
  try {
    const kinds = await invoke<PathKind[]>("path_kinds", { paths });
    return kinds.length === paths.length ? kinds : paths.map(guessedKind);
  } catch {
    return paths.map(guessedKind);
  }
}

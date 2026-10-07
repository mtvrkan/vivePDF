import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { dirnameOf } from "./paths";

export class RevealError extends Error {
  constructor(public reasonKey: string) {
    super(reasonKey);
  }
}

export async function revealPath(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) throw new RevealError("errors.revealEmptyPath");

  try {
    await revealItemInDir(trimmed);
    return;
  } catch {
    const parentDir = dirnameOf(trimmed) || trimmed;

    try {
      await revealItemInDir(parentDir);
      return;
    } catch {
      try {
        await invoke("open_folder", { path: parentDir });
        return;
      } catch {
        try {
          await invoke("reveal_path", { path: trimmed });
          return;
        } catch {
          throw new RevealError("errors.revealFailed");
        }
      }
    }
  }
}

export function sameDirectory(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const first = dirnameOf(paths[0]);
  return paths.every((path) => dirnameOf(path) === first) ? first : null;
}

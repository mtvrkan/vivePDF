import { join, tempDir } from "@tauri-apps/api/path";
import * as logger from "@/shared/lib/logger";
import { rangesOf } from "@/shared/rpc/analyze";
import type { RpcCallOptions } from "@/shared/rpc/client";
import { deleteFile } from "@/shared/rpc/files";
import { assemblePages } from "@/shared/rpc/operations";
import type { OrganizerTile } from "@/types";
import type { Arrangement } from "./arrangement";
import { MAIN_SOURCE_ID } from "./organizerStore";

export type ExportSource = { path: string; password: string | null; pages: string | null; pageCount: number; temporary: boolean };

export function directMainPages(tiles: readonly OrganizerTile[]): string | null {
  const indexes: number[] = [];
  for (const tile of tiles) {
    if (tile.kind !== "page" || tile.sourceId !== MAIN_SOURCE_ID || tile.rotate !== 0) return null;
    if (indexes.length > 0 && tile.index <= indexes[indexes.length - 1]) return null;
    indexes.push(tile.index);
  }
  return indexes.length > 0 ? rangesOf(indexes.map((index) => index - 1)) : null;
}

export function discardExportCopy(path: string): void {
  void deleteFile(path).catch((caught: unknown) => logger.warn("pages.export", `could not delete ${path}: ${String(caught)}`));
}

export async function exportSourceOf(
  tiles: readonly OrganizerTile[],
  main: { path: string; password: string | null },
  arranged: Arrangement,
  options?: RpcCallOptions,
): Promise<ExportSource> {
  const pages = directMainPages(tiles);
  if (pages) return { path: main.path, password: main.password, pages, pageCount: tiles.length, temporary: false };
  const path = await join(await tempDir(), `vivepdf-pages-${crypto.randomUUID()}.pdf`);
  try {
    const result = await assemblePages({ ...arranged, output: path, overwrite: true }, options);
    return { path, password: main.password, pages: null, pageCount: result.pageCount, temporary: true };
  } catch (caught) {
    discardExportCopy(path);
    throw caught;
  }
}

import { create } from "zustand";
import type { OrganizerSource, OrganizerTile, PaperPattern } from "@/types";

export type ClippedSource = { path: string; password: string | null };

export type ClippedTile =
  | { kind: "page"; source: ClippedSource; index: number; rotate: OrganizerTile["rotate"] }
  | { kind: "blank"; width: number; height: number; rotate: OrganizerTile["rotate"]; paper?: PaperPattern }
  | { kind: "image"; path: string; fileName: string; rotate: OrganizerTile["rotate"] };

type PageClipboardState = {
  tiles: ClippedTile[];
  setTiles: (tiles: ClippedTile[]) => void;
};

export const usePageClipboard = create<PageClipboardState>((set) => ({
  tiles: [],
  setTiles: (tiles) => set({ tiles }),
}));

export function clipTiles(tiles: OrganizerTile[], selected: ReadonlySet<string>, sources: Record<string, OrganizerSource>): ClippedTile[] {
  const clipped: ClippedTile[] = [];
  for (const tile of tiles) {
    if (!selected.has(tile.key)) continue;
    if (tile.kind === "page") {
      const source = sources[tile.sourceId];
      if (source) clipped.push({ kind: "page", source: { path: source.path, password: source.password }, index: tile.index, rotate: tile.rotate });
    } else if (tile.kind === "blank") {
      clipped.push({ kind: "blank", width: tile.width, height: tile.height, rotate: tile.rotate, ...(tile.paper ? { paper: tile.paper } : {}) });
    } else {
      clipped.push({ kind: "image", path: tile.path, fileName: tile.fileName, rotate: tile.rotate });
    }
  }
  return clipped;
}

export function clippedSourcePaths(tiles: ClippedTile[]): ClippedSource[] {
  const seen = new Map<string, ClippedSource>();
  for (const tile of tiles) if (tile.kind === "page" && !seen.has(tile.source.path)) seen.set(tile.source.path, tile.source);
  return [...seen.values()];
}

export function pastedTiles(
  clipped: ClippedTile[],
  sourceIdByPath: ReadonlyMap<string, string>,
  previewByPath: ReadonlyMap<string, string>,
  newKey: () => string,
): OrganizerTile[] {
  const tiles: OrganizerTile[] = [];
  for (const tile of clipped) {
    if (tile.kind === "page") {
      const sourceId = sourceIdByPath.get(tile.source.path);
      if (sourceId) tiles.push({ key: newKey(), kind: "page", sourceId, index: tile.index, rotate: tile.rotate });
    } else if (tile.kind === "blank") {
      tiles.push({ key: newKey(), kind: "blank", width: tile.width, height: tile.height, rotate: tile.rotate, ...(tile.paper ? { paper: tile.paper } : {}) });
    } else {
      tiles.push({ key: newKey(), kind: "image", path: tile.path, fileName: tile.fileName, previewUrl: previewByPath.get(tile.path) ?? "", rotate: tile.rotate });
    }
  }
  return tiles;
}

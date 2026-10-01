import type { OrganizerTile, PageRotation } from "@/types";

export type PagesBySource = Record<string, ReadonlySet<number>>;
export type RotationsBySource = Record<string, ReadonlyMap<number, number>>;

export function sourcesInUse(tiles: OrganizerTile[]): string[] {
  const ids = new Set<string>();
  for (const tile of tiles) if (tile.kind === "page") ids.add(tile.sourceId);
  return [...ids];
}

export function analyzedTiles(tiles: OrganizerTile[], pages: PagesBySource, includeBlankTiles: boolean): string[] {
  return tiles
    .filter((tile) => (tile.kind === "page" ? (pages[tile.sourceId]?.has(tile.index) ?? false) : includeBlankTiles && tile.kind === "blank" && !tile.paper))
    .map((tile) => tile.key);
}

function asRotation(value: number): PageRotation | null {
  const normalized = ((value % 360) + 360) % 360;
  return normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270 ? normalized : null;
}

export function withDetectedRotation(tiles: OrganizerTile[], rotations: RotationsBySource): { tiles: OrganizerTile[]; changed: number } {
  let changed = 0;
  const next = tiles.map((tile) => {
    if (tile.kind !== "page") return tile;
    const detected = rotations[tile.sourceId]?.get(tile.index);
    if (detected === undefined) return tile;
    const rotate = asRotation(detected);
    if (rotate === null || rotate === tile.rotate) return tile;
    changed += 1;
    return { ...tile, rotate };
  });
  return { tiles: changed > 0 ? next : tiles, changed };
}

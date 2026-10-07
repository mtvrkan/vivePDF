import type { OrganizerTile, PageSize } from "@/types";

export type Size = { width: number; height: number };
export type KnownSizes = { pages: ReadonlyMap<string, readonly PageSize[]>; images: ReadonlyMap<string, Size> };
export type Orientation = "portrait" | "landscape" | "square";
export type PaperName = "a3" | "a4" | "a5" | "letter" | "legal";
export type SizeGroup = { id: string; size: Size; paper: PaperName | null; keys: string[] };

const SIZE_TOLERANCE = 2;
const MAX_IMAGE_PAGE: Size = { width: 595, height: 842 };
const PAPERS: ReadonlyArray<[PaperName, Size]> = [
  ["a4", { width: 595.28, height: 841.89 }],
  ["letter", { width: 612, height: 792 }],
  ["a3", { width: 841.89, height: 1190.55 }],
  ["a5", { width: 419.53, height: 595.28 }],
  ["legal", { width: 612, height: 1008 }],
];

export function imagePageSize(pixels: Size): Size {
  const limit = pixels.width > pixels.height ? { width: MAX_IMAGE_PAGE.height, height: MAX_IMAGE_PAGE.width } : MAX_IMAGE_PAGE;
  const scale = Math.min(limit.width / pixels.width, limit.height / pixels.height, 1);
  return { width: pixels.width * scale, height: pixels.height * scale };
}

function isQuarterTurned(rotate: number): boolean {
  return rotate % 180 === 90;
}

export function tileSize(tile: OrganizerTile, known: KnownSizes): Size | null {
  const base = tile.kind === "page" ? known.pages.get(tile.sourceId)?.[tile.index - 1] : tile.kind === "blank" ? tile : known.images.get(tile.path);
  if (!base) return null;
  return isQuarterTurned(tile.rotate) ? { width: base.height, height: base.width } : { width: base.width, height: base.height };
}

export function orientationOf(size: Size): Orientation {
  if (Math.abs(size.width - size.height) < 1) return "square";
  return size.height > size.width ? "portrait" : "landscape";
}

function upright(size: Size): Size {
  return { width: Math.min(size.width, size.height), height: Math.max(size.width, size.height) };
}

function close(a: Size, b: Size): boolean {
  return Math.abs(a.width - b.width) <= SIZE_TOLERANCE && Math.abs(a.height - b.height) <= SIZE_TOLERANCE;
}

export function paperOf(size: Size): PaperName | null {
  const shape = upright(size);
  return PAPERS.find(([, paper]) => close(shape, paper))?.[0] ?? null;
}

export function tilesInOrientation(tiles: readonly OrganizerTile[], known: KnownSizes, orientation: Orientation): string[] {
  return tiles.flatMap((tile) => {
    const size = tileSize(tile, known);
    return size && orientationOf(size) === orientation ? [tile.key] : [];
  });
}

export function sizeGroups(tiles: readonly OrganizerTile[], known: KnownSizes): SizeGroup[] {
  const groups: SizeGroup[] = [];
  for (const tile of tiles) {
    const size = tileSize(tile, known);
    if (!size) continue;
    const shape = upright(size);
    const group = groups.find((candidate) => close(candidate.size, shape));
    if (group) group.keys.push(tile.key);
    else groups.push({ id: `${Math.round(shape.width)}x${Math.round(shape.height)}`, size: shape, paper: paperOf(shape), keys: [tile.key] });
  }
  return groups.sort((a, b) => b.keys.length - a.keys.length);
}

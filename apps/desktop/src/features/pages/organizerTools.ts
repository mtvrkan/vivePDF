import type { OrganizerTile, PageLabelRule, PageLabelStyle } from "@/types";

export type PageKeysBySource = Record<string, ReadonlySet<number>>;

export function bookmarkCuts(tiles: OrganizerTile[], chapterStarts: PageKeysBySource): string[] {
  const cuts: string[] = [];
  tiles.forEach((tile, position) => {
    if (position === 0 || tile.kind !== "page") return;
    if (chapterStarts[tile.sourceId]?.has(tile.index)) cuts.push(tiles[position - 1].key);
  });
  return cuts;
}

export function topLevelStarts(items: Array<{ level: number; page: number }>): Set<number> {
  const top = Math.min(...items.map((item) => item.level));
  return new Set(items.filter((item) => item.level === top && item.page > 1).map((item) => item.page));
}

export type FingerprintsBySource = Record<string, ReadonlyArray<string | null>>;

function tileSignature(tile: OrganizerTile, fingerprints: FingerprintsBySource): string | null {
  if (tile.kind === "page") {
    const fingerprint = fingerprints[tile.sourceId]?.[tile.index - 1];
    return fingerprint ? `page:${fingerprint}` : null;
  }
  if (tile.kind === "image") return `image:${tile.path}`;
  return null;
}

export function duplicateTiles(tiles: OrganizerTile[], fingerprints: FingerprintsBySource): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const tile of tiles) {
    const signature = tileSignature(tile, fingerprints);
    if (!signature) continue;
    if (seen.has(signature)) duplicates.push(tile.key);
    else seen.add(signature);
  }
  return duplicates;
}

export type DuplexOptions = { padding: { width: number; height: number } | null; reverseBacks: boolean };

export function duplexOrder(tiles: OrganizerTile[], options: DuplexOptions, newKey: () => string): { tiles: OrganizerTile[]; cutAfter: string | null } {
  const padded: OrganizerTile[] =
    tiles.length % 2 === 1 && options.padding ? [...tiles, { key: newKey(), kind: "blank", width: options.padding.width, height: options.padding.height, rotate: 0 }] : tiles;
  const fronts = padded.filter((_, position) => position % 2 === 0);
  const backs = padded.filter((_, position) => position % 2 === 1);
  if (options.reverseBacks) backs.reverse();
  return { tiles: [...fronts, ...backs], cutAfter: backs.length > 0 ? fronts[fronts.length - 1].key : null };
}

export type TileLabel = { style: PageLabelStyle; prefix: string; firstNumber: number };

export type TileLabels = Record<string, TileLabel>;

const LABEL_STYLES: ReadonlySet<string> = new Set(["D", "r", "R", "a", "A", ""]);
const LABEL_PREFIX_LIMIT = 64;
const LABEL_NUMBER_LIMIT = 100_000;

export function restoredLabels(stored: unknown, keys: ReadonlySet<string>): TileLabels {
  if (typeof stored !== "object" || stored === null) return {};
  const labels: TileLabels = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!keys.has(key) || typeof value !== "object" || value === null) continue;
    const { style, prefix, firstNumber } = value as Record<string, unknown>;
    if (typeof style !== "string" || !LABEL_STYLES.has(style) || typeof prefix !== "string" || prefix.length > LABEL_PREFIX_LIMIT) continue;
    if (typeof firstNumber !== "number" || !Number.isInteger(firstNumber) || firstNumber < 1 || firstNumber > LABEL_NUMBER_LIMIT) continue;
    labels[key] = { style: style as PageLabelStyle, prefix, firstNumber };
  }
  return labels;
}

export function restoredCuts(stored: unknown, keys: ReadonlySet<string>): Set<string> {
  if (!Array.isArray(stored)) return new Set();
  return new Set(stored.filter((key): key is string => typeof key === "string" && keys.has(key)));
}

export function labelRules(tiles: OrganizerTile[], labels: TileLabels): PageLabelRule[] {
  return tiles.flatMap((tile, position) => {
    const label = labels[tile.key];
    return label ? [{ start: position, style: label.style, prefix: label.prefix, firstNumber: label.firstNumber }] : [];
  });
}

const ROMAN: Array<[number, string]> = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function roman(value: number): string {
  let rest = value;
  let text = "";
  for (const [amount, symbol] of ROMAN) {
    while (rest >= amount) {
      text += symbol;
      rest -= amount;
    }
  }
  return text;
}

function letters(value: number): string {
  const letter = String.fromCharCode(97 + ((value - 1) % 26));
  return letter.repeat(Math.floor((value - 1) / 26) + 1);
}

export function formatLabel({ style, prefix, firstNumber }: TileLabel, offset: number): string {
  const value = firstNumber + offset;
  if (style === "D") return `${prefix}${value}`;
  if (style === "r") return `${prefix}${roman(value)}`;
  if (style === "R") return `${prefix}${roman(value).toUpperCase()}`;
  if (style === "a") return `${prefix}${letters(value)}`;
  if (style === "A") return `${prefix}${letters(value).toUpperCase()}`;
  return prefix;
}

export function tileLabelTexts(tiles: OrganizerTile[], labels: TileLabels): string[] | null {
  if (!tiles.some((tile) => labels[tile.key])) return null;
  let current: { label: TileLabel; start: number } | null = null;
  return tiles.map((tile, position) => {
    const label = labels[tile.key];
    if (label) current = { label, start: position };
    return current ? formatLabel(current.label, position - current.start) : String(position + 1);
  });
}

export function positionsToKeys(tiles: OrganizerTile[], positions: number[]): string[] {
  return [...new Set(positions)].flatMap((position) => (tiles[position - 1] ? [tiles[position - 1].key] : []));
}

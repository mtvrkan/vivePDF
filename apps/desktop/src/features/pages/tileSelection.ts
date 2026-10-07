import type { OrganizerTile } from "@/types";

export type ClickMode = "replace" | "toggle" | "range" | "rangeAdd";

export type ClickModifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

export function tileClickMode(event: ClickModifiers, additive: boolean): ClickMode {
  if (event.shiftKey) return additive ? "rangeAdd" : "range";
  if (additive || event.ctrlKey || event.metaKey) return "toggle";
  return "replace";
}

export function clickSelection(
  tiles: OrganizerTile[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  key: string,
  mode: ClickMode,
): { keys: string[]; anchor: string | null } {
  const position = tiles.findIndex((tile) => tile.key === key);
  const from = anchor ? tiles.findIndex((tile) => tile.key === anchor) : -1;
  if ((mode === "range" || mode === "rangeAdd") && from >= 0 && position >= 0) {
    const [start, end] = from < position ? [from, position] : [position, from];
    const range = tiles.slice(start, end + 1).map((tile) => tile.key);
    return { keys: mode === "range" ? range : [...new Set([...selected, ...range])], anchor };
  }
  if (mode === "replace" && selected.size === 1 && selected.has(key)) return { keys: [], anchor: key };
  if (mode === "replace" || mode === "range") return { keys: [key], anchor: key };
  return { keys: [...toggledSelection(selected, key)], anchor: key };
}

export function spanSelection(tiles: OrganizerTile[], base: ReadonlySet<string>, origin: string, focus: number): string[] {
  const from = tiles.findIndex((tile) => tile.key === origin);
  if (from < 0 || focus < 0 || focus >= tiles.length) return [...base];
  const [start, end] = from < focus ? [from, focus] : [focus, from];
  return [...new Set([...base, ...tiles.slice(start, end + 1).map((tile) => tile.key)])];
}

export type TileClickAction = { kind: "select"; mode: ClickMode } | { kind: "none" };

export function tileClickAction(event: ClickModifiers, multiSelect: boolean, dragged: boolean): TileClickAction {
  if (dragged) return { kind: "none" };
  return { kind: "select", mode: tileClickMode(event, multiSelect) };
}

export function toggledSelection(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

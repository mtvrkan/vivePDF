import { create } from "zustand";
import type { OrganizerSource, OrganizerTile, PageRotation } from "@/types";
import { restoredCuts, restoredLabels, type TileLabels } from "./organizerTools";

const HISTORY_LIMIT = 100;
export const MAIN_SOURCE_ID = "main";

export type OrganizerMarks = { cuts: ReadonlySet<string>; labels: TileLabels };

export type OrganizerStep = OrganizerMarks & { tiles: OrganizerTile[] };

const NO_MARKS: OrganizerMarks = { cuts: new Set(), labels: {} };

type OrganizerState = OrganizerMarks & {
  documentId: string | null;
  sources: Record<string, OrganizerSource>;
  tiles: OrganizerTile[];
  initialTiles: OrganizerTile[];
  past: OrganizerStep[];
  future: OrganizerStep[];
  selected: Set<string>;
  anchor: string | null;
  initialize: (main: OrganizerSource & { embedDocId: string }) => void;
  clear: () => void;
  unavailable: ReadonlySet<string>;
  addSource: (source: OrganizerSource) => void;
  attachSource: (id: string, patch: Pick<OrganizerSource, "embedDocId" | "password">) => void;
  markUnavailable: (id: string) => void;
  pruneUnusedSources: () => void;
  commit: (tiles: OrganizerTile[], marks?: Partial<OrganizerMarks>) => void;
  setMarks: (marks: Partial<OrganizerMarks>) => void;
  undo: () => void;
  redo: () => void;
  select: (keys: Iterable<string>, anchor?: string | null) => void;
  reset: () => void;
  restore: (
    snapshot: { mainPath: string; tiles: OrganizerTile[]; sources: Array<Omit<OrganizerSource, "embedDocId" | "password">>; selected: string[]; cuts?: unknown; labels?: unknown },
    embedDocId: string,
    password: string | null,
  ) => void;
};

export function rotateBy(current: PageRotation, delta: 90 | -90): PageRotation {
  return ((((current + delta) % 360) + 360) % 360) as PageRotation;
}

export function tileKey(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function hiddenDocumentIds(sources: Record<string, OrganizerSource>): Set<string> {
  const ids = new Set<string>();
  for (const source of Object.values(sources)) if (source.id !== MAIN_SOURCE_ID && source.embedDocId) ids.add(source.embedDocId);
  return ids;
}

const sourceIdsByGroup = new WeakMap<OrganizerTile[], Set<string>>();
const previewUrlsByGroup = new WeakMap<OrganizerTile[], Set<string>>();

function groupSet(cache: WeakMap<OrganizerTile[], Set<string>>, group: OrganizerTile[], pick: (tile: OrganizerTile) => string | null): Set<string> {
  const cached = cache.get(group);
  if (cached) return cached;
  const values = new Set<string>();
  for (const tile of group) {
    const value = pick(tile);
    if (value) values.add(value);
  }
  cache.set(group, values);
  return values;
}

function unionOf(cache: WeakMap<OrganizerTile[], Set<string>>, groups: OrganizerTile[][], pick: (tile: OrganizerTile) => string | null): Set<string> {
  const values = new Set<string>();
  for (const group of groups) for (const value of groupSet(cache, group, pick)) values.add(value);
  return values;
}

const sourceIdOf = (tile: OrganizerTile) => (tile.kind === "page" ? tile.sourceId : null);
const previewUrlOf = (tile: OrganizerTile) => (tile.kind === "image" && tile.previewUrl ? tile.previewUrl : null);

export function referencedSourceIds(groups: OrganizerTile[][]): Set<string> {
  return unionOf(sourceIdsByGroup, groups, sourceIdOf);
}

export function pruneDroppedSources(sources: Record<string, OrganizerSource>, before: OrganizerTile[][], after: OrganizerTile[][]): Record<string, OrganizerSource> {
  const wasUsed = referencedSourceIds(before);
  const stillUsed = referencedSourceIds(after);
  const dropped = Object.keys(sources).filter((id) => id !== MAIN_SOURCE_ID && wasUsed.has(id) && !stillUsed.has(id));
  if (dropped.length === 0) return sources;
  const next = { ...sources };
  for (const id of dropped) delete next[id];
  return next;
}

function previewUrls(groups: OrganizerTile[][]): Set<string> {
  return unionOf(previewUrlsByGroup, groups, previewUrlOf);
}

function releasePreviews(groups: OrganizerTile[][]): void {
  for (const url of previewUrls(groups)) URL.revokeObjectURL(url);
}

export function droppedPreviews(before: OrganizerTile[][], after: OrganizerTile[][]): string[] {
  const kept = previewUrls(after);
  return [...previewUrls(before)].filter((url) => !kept.has(url));
}

export function withoutUnusedSources(sources: Record<string, OrganizerSource>, groups: OrganizerTile[][]): Record<string, OrganizerSource> {
  const used = referencedSourceIds(groups);
  const unused = Object.keys(sources).filter((id) => id !== MAIN_SOURCE_ID && !used.has(id));
  if (unused.length === 0) return sources;
  const next = { ...sources };
  for (const id of unused) delete next[id];
  return next;
}

export function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

export function sameLabels(left: TileLabels, right: TileLabels): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function tilesOf(steps: OrganizerStep[]): OrganizerTile[][] {
  return steps.map((step) => step.tiles);
}

function stepOf(state: OrganizerStep): OrganizerStep {
  return { tiles: state.tiles, cuts: state.cuts, labels: state.labels };
}

function historyTiles(state: OrganizerState): OrganizerTile[][] {
  return [state.tiles, state.initialTiles, ...tilesOf(state.past), ...tilesOf(state.future)];
}

export const useOrganizerStore = create<OrganizerState>((set, get) => ({
  ...NO_MARKS,
  documentId: null,
  sources: {},
  tiles: [],
  initialTiles: [],
  past: [],
  future: [],
  selected: new Set(),
  anchor: null,
  unavailable: new Set(),
  initialize: (main) => {
    releasePreviews(historyTiles(get()));
    const tiles: OrganizerTile[] = Array.from({ length: main.pageCount }, (_, index) => ({
      key: `p${index + 1}`,
      kind: "page",
      sourceId: MAIN_SOURCE_ID,
      index: index + 1,
      rotate: 0,
    }));
    set({
      documentId: main.embedDocId,
      sources: { [MAIN_SOURCE_ID]: { ...main, id: MAIN_SOURCE_ID } },
      tiles,
      initialTiles: tiles,
      past: [],
      future: [],
      selected: new Set(),
      anchor: null,
      unavailable: new Set(),
      ...NO_MARKS,
    });
  },
  clear: () => {
    releasePreviews(historyTiles(get()));
    set({ documentId: null, sources: {}, tiles: [], initialTiles: [], past: [], future: [], selected: new Set(), anchor: null, unavailable: new Set(), ...NO_MARKS });
  },
  addSource: (source) => set((state) => ({ sources: { ...state.sources, [source.id]: source } })),
  attachSource: (id, patch) =>
    set((state) => {
      const source = state.sources[id];
      if (!source) return {};
      const unavailable = new Set(state.unavailable);
      unavailable.delete(id);
      return { sources: { ...state.sources, [id]: { ...source, ...patch } }, unavailable };
    }),
  markUnavailable: (id) => set((state) => (state.sources[id] ? { unavailable: new Set([...state.unavailable, id]) } : {})),
  pruneUnusedSources: () =>
    set((state) => {
      const sources = withoutUnusedSources(state.sources, historyTiles(state));
      return sources === state.sources ? {} : { sources };
    }),
  commit: (tiles, marks = {}) =>
    set((state) => {
      const alive = new Set(tiles.map((tile) => tile.key));
      const past = [...state.past.slice(-HISTORY_LIMIT + 1), stepOf(state)];
      const before = historyTiles(state);
      const after = [tiles, state.initialTiles, ...tilesOf(past)];
      for (const url of droppedPreviews(before, after)) URL.revokeObjectURL(url);
      return {
        tiles,
        cuts: marks.cuts ?? state.cuts,
        labels: marks.labels ?? state.labels,
        past,
        future: [],
        sources: tiles === state.tiles ? state.sources : pruneDroppedSources(state.sources, before, after),
        selected: tiles === state.tiles ? state.selected : new Set([...state.selected].filter((key) => alive.has(key))),
      };
    }),
  setMarks: (marks) => {
    const state = get();
    const cutsChanged = marks.cuts !== undefined && !sameKeys(marks.cuts, state.cuts);
    const labelsChanged = marks.labels !== undefined && !sameLabels(marks.labels, state.labels);
    if (cutsChanged || labelsChanged) state.commit(state.tiles, marks);
  },
  undo: () => {
    const state = get();
    if (state.past.length === 0) return;
    const previous = state.past[state.past.length - 1];
    const alive = new Set(previous.tiles.map((tile) => tile.key));
    set({
      ...previous,
      past: state.past.slice(0, -1),
      future: [stepOf(state), ...state.future],
      selected: new Set([...state.selected].filter((key) => alive.has(key))),
    });
  },
  redo: () => {
    const state = get();
    if (state.future.length === 0) return;
    const [next, ...rest] = state.future;
    const alive = new Set(next.tiles.map((tile) => tile.key));
    set({
      ...next,
      past: [...state.past, stepOf(state)],
      future: rest,
      selected: new Set([...state.selected].filter((key) => alive.has(key))),
    });
  },
  select: (keys, anchor) =>
    set((state) => ({ selected: new Set(keys), anchor: anchor === undefined ? state.anchor : anchor })),
  reset: () => {
    const { initialTiles } = get();
    get().commit(initialTiles, NO_MARKS);
  },
  restore: (snapshot, embedDocId, password) => {
    releasePreviews(historyTiles(get()));
    const sources: Record<string, OrganizerSource> = {};
    for (const source of snapshot.sources) {
      sources[source.id] = {
        ...source,
        password: source.id === MAIN_SOURCE_ID ? password : null,
        embedDocId: source.id === MAIN_SOURCE_ID ? embedDocId : null,
      };
    }
    const main = sources[MAIN_SOURCE_ID];
    if (!main) return;
    const initialTiles: OrganizerTile[] = Array.from({ length: main.pageCount }, (_, index) => ({
      key: `p${index + 1}`,
      kind: "page",
      sourceId: MAIN_SOURCE_ID,
      index: index + 1,
      rotate: 0,
    }));
    const keys = new Set(snapshot.tiles.map((tile) => tile.key));
    set({
      documentId: embedDocId,
      sources,
      tiles: snapshot.tiles,
      initialTiles,
      cuts: restoredCuts(snapshot.cuts, keys),
      labels: restoredLabels(snapshot.labels, keys),
      past: [{ tiles: initialTiles, ...NO_MARKS }],
      future: [],
      selected: new Set(snapshot.selected),
      anchor: null,
      unavailable: new Set(),
    });
  },
}));

export function isDirty(tiles: OrganizerTile[], initialTiles: OrganizerTile[]): boolean {
  if (tiles.length !== initialTiles.length) return true;
  return tiles.some((tile, position) => {
    const original = initialTiles[position];
    return tile.kind !== "page" || original.kind !== "page" || tile.sourceId !== original.sourceId || tile.index !== original.index || tile.rotate !== 0;
  });
}

export function moveTiles(tiles: OrganizerTile[], keys: Set<string>, dropIndex: number): OrganizerTile[] {
  const moving = tiles.filter((tile) => keys.has(tile.key));
  if (moving.length === 0) return tiles;
  const before = tiles.slice(0, dropIndex).filter((tile) => !keys.has(tile.key));
  const after = tiles.slice(dropIndex).filter((tile) => !keys.has(tile.key));
  return [...before, ...moving, ...after];
}

export function nudgeTiles(tiles: OrganizerTile[], keys: ReadonlySet<string>, delta: number): OrganizerTile[] {
  if (delta === 0 || keys.size === 0) return tiles;
  const next = [...tiles];
  const forward = delta > 0;
  for (let step = 0; step < Math.abs(delta); step += 1) {
    let moved = false;
    let blocked = true;
    for (let offset = 0; offset < next.length; offset += 1) {
      const position = forward ? next.length - 1 - offset : offset;
      if (!keys.has(next[position].key)) {
        blocked = false;
        continue;
      }
      const target = forward ? position + 1 : position - 1;
      if (blocked || target < 0 || target >= next.length) continue;
      [next[position], next[target]] = [next[target], next[position]];
      moved = true;
    }
    if (!moved) break;
  }
  return next.every((tile, position) => tile === tiles[position]) ? tiles : next;
}

export function moveToPosition(tiles: OrganizerTile[], keys: ReadonlySet<string>, position: number): OrganizerTile[] {
  const moving = tiles.filter((tile) => keys.has(tile.key));
  if (moving.length === 0) return tiles;
  const kept = tiles.filter((tile) => !keys.has(tile.key));
  const at = Math.max(0, Math.min(kept.length, Math.floor(position) - 1));
  const next = [...kept.slice(0, at), ...moving, ...kept.slice(at)];
  return next.every((tile, index) => tile === tiles[index]) ? tiles : next;
}

export function insertTiles(tiles: OrganizerTile[], position: number, incoming: OrganizerTile[]): OrganizerTile[] {
  const at = Math.max(0, Math.min(position, tiles.length));
  return [...tiles.slice(0, at), ...incoming, ...tiles.slice(at)];
}

export function insertionPoint(tiles: OrganizerTile[], selected: Set<string>): number {
  let last = -1;
  tiles.forEach((tile, position) => {
    if (selected.has(tile.key)) last = position;
  });
  return last >= 0 ? last + 1 : tiles.length;
}

export function tilesAtParity(tiles: OrganizerTile[], parity: "odd" | "even"): string[] {
  const remainder = parity === "odd" ? 0 : 1;
  return tiles.filter((_, position) => position % 2 === remainder).map((tile) => tile.key);
}

export function replaceTiles(tiles: OrganizerTile[], selected: Set<string>, incoming: OrganizerTile[]): OrganizerTile[] {
  const first = tiles.findIndex((tile) => selected.has(tile.key));
  if (first < 0) return insertTiles(tiles, tiles.length, incoming);
  const kept = tiles.filter((tile) => !selected.has(tile.key));
  const before = tiles.slice(0, first).filter((tile) => !selected.has(tile.key)).length;
  return insertTiles(kept, before, incoming);
}

export function cutStarts(tiles: OrganizerTile[], cuts: ReadonlySet<string>): number[] {
  return tiles.flatMap((tile, position) => (cuts.has(tile.key) && position < tiles.length - 1 ? [position + 1] : []));
}

export function toggleCuts(cuts: ReadonlySet<string>, keys: Iterable<string>): Set<string> {
  const chosen = [...keys];
  const next = new Set(cuts);
  const removing = chosen.length > 0 && chosen.every((key) => next.has(key));
  for (const key of chosen) {
    if (removing) next.delete(key);
    else next.add(key);
  }
  return next;
}

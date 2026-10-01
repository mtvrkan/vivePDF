import { useCallback, useRef } from "react";
import type { OrganizerTile } from "@/types";
import type { TileLabels } from "./organizerTools";
import { insertTiles, insertionPoint, moveToPosition, nudgeTiles, replaceTiles, rotateBy, tileKey, toggleCuts, useOrganizerStore } from "./organizerStore";
import { spanSelection } from "./tileSelection";

export type CutsUpdate = ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>);
export type LabelsUpdate = TileLabels | ((current: TileLabels) => TileLabels);

type ExtendRun = { origin: string; base: ReadonlySet<string>; focus: string; selection: ReadonlySet<string> };

export function useOrganizerEdits(revealIndex: (index: number) => void) {
  const commit = useOrganizerStore((state) => state.commit);
  const select = useOrganizerStore((state) => state.select);
  const setMarks = useOrganizerStore((state) => state.setMarks);
  const extendRun = useRef<ExtendRun | null>(null);

  const setCuts = useCallback(
    (next: CutsUpdate) => {
      const current = useOrganizerStore.getState().cuts;
      setMarks({ cuts: typeof next === "function" ? next(current) : next });
    },
    [setMarks],
  );

  const setLabels = useCallback(
    (next: LabelsUpdate) => {
      const current = useOrganizerStore.getState().labels;
      setMarks({ labels: typeof next === "function" ? next(current) : next });
    },
    [setMarks],
  );

  const scrollToTile = useCallback(
    (key: string) => {
      revealIndex(useOrganizerStore.getState().tiles.findIndex((tile) => tile.key === key));
    },
    [revealIndex],
  );

  const selectAndReveal = useCallback(
    (keys: string[]) => {
      select(keys, keys[0] ?? null);
      if (keys[0]) scrollToTile(keys[0]);
    },
    [select, scrollToTile],
  );

  const updateSelected = useCallback(
    (update: (tile: OrganizerTile) => OrganizerTile) => {
      const state = useOrganizerStore.getState();
      if (state.selected.size === 0) return;
      commit(state.tiles.map((tile) => (state.selected.has(tile.key) ? update(tile) : tile)));
    },
    [commit],
  );

  const rotateSelected = useCallback((delta: 90 | -90) => updateSelected((tile) => ({ ...tile, rotate: rotateBy(tile.rotate, delta) })), [updateSelected]);

  const deleteSelected = useCallback(() => {
    const state = useOrganizerStore.getState();
    if (state.selected.size === 0 || state.selected.size === state.tiles.length) return;
    commit(state.tiles.filter((tile) => !state.selected.has(tile.key)));
  }, [commit]);

  const deleteRelative = useCallback(
    (direction: "before" | "after") => {
      const { tiles, selected } = useOrganizerStore.getState();
      const [key] = selected;
      const position = tiles.findIndex((tile) => tile.key === key);
      if (position < 0) return;
      commit(direction === "before" ? tiles.slice(position) : tiles.slice(0, position + 1));
    },
    [commit],
  );

  const reverseAll = useCallback(() => commit([...useOrganizerStore.getState().tiles].reverse()), [commit]);

  const duplicateSelected = useCallback(() => {
    const state = useOrganizerStore.getState();
    if (state.selected.size === 0) return;
    const next: OrganizerTile[] = [];
    const copies: string[] = [];
    for (const tile of state.tiles) {
      next.push(tile);
      if (state.selected.has(tile.key)) {
        const copy = { ...tile, key: tileKey() };
        next.push(copy);
        copies.push(copy.key);
      }
    }
    commit(next);
    select(copies);
  }, [commit, select]);

  const insertAtSelection = useCallback(
    (incoming: OrganizerTile[]) => {
      const state = useOrganizerStore.getState();
      const at = insertionPoint(state.tiles, state.selected);
      commit(insertTiles(state.tiles, at, incoming));
      select(incoming.map((tile) => tile.key), incoming[0]?.key ?? null);
    },
    [commit, select],
  );

  const replaceSelection = useCallback(
    (incoming: OrganizerTile[]) => {
      const state = useOrganizerStore.getState();
      commit(replaceTiles(state.tiles, state.selected, incoming));
      select(incoming.map((tile) => tile.key), incoming[0]?.key ?? null);
    },
    [commit, select],
  );

  const moveSelection = useCallback(
    (delta: number, extend: boolean) => {
      const state = useOrganizerStore.getState();
      const current = state.anchor ? state.tiles.findIndex((tile) => tile.key === state.anchor) : -1;
      const next = Math.max(0, Math.min(state.tiles.length - 1, current < 0 ? 0 : current + delta));
      const key = state.tiles[next]?.key;
      if (!key) return;
      if (extend && state.anchor) {
        const previous = extendRun.current;
        const run = previous && previous.focus === state.anchor && previous.selection === state.selected ? previous : { origin: state.anchor, base: state.selected, focus: state.anchor, selection: state.selected };
        select(spanSelection(state.tiles, run.base, run.origin, next), key);
        extendRun.current = { ...run, focus: key, selection: useOrganizerStore.getState().selected };
      } else {
        extendRun.current = null;
        select([key], key);
      }
      scrollToTile(key);
    },
    [select, scrollToTile],
  );

  const commitReorder = useCallback(
    (reorder: (tiles: OrganizerTile[], keys: ReadonlySet<string>) => OrganizerTile[]) => {
      const state = useOrganizerStore.getState();
      if (state.selected.size === 0) return;
      const next = reorder(state.tiles, state.selected);
      if (next === state.tiles) return;
      commit(next);
      const focus = state.anchor && state.selected.has(state.anchor) ? state.anchor : next.find((tile) => state.selected.has(tile.key))?.key;
      if (focus) scrollToTile(focus);
    },
    [commit, scrollToTile],
  );

  const nudgeSelected = useCallback((delta: number) => commitReorder((tiles, keys) => nudgeTiles(tiles, keys, delta)), [commitReorder]);

  const moveSelectedTo = useCallback((position: number) => commitReorder((tiles, keys) => moveToPosition(tiles, keys, position)), [commitReorder]);

  const toggleCutsAtSelection = useCallback(() => {
    const state = useOrganizerStore.getState();
    const lastKey = state.tiles[state.tiles.length - 1]?.key;
    setCuts((current) => toggleCuts(current, [...state.selected].filter((key) => key !== lastKey)));
  }, [setCuts]);

  const toggleCutAt = useCallback((key: string) => setCuts((current) => toggleCuts(current, [key])), [setCuts]);

  const focusTileKey = useCallback((): string | null => {
    const state = useOrganizerStore.getState();
    const alive = (key: string | null) => key !== null && state.tiles.some((tile) => tile.key === key);
    if (alive(state.anchor) && state.selected.has(state.anchor as string)) return state.anchor;
    const firstSelected = state.tiles.find((tile) => state.selected.has(tile.key));
    return firstSelected?.key ?? (alive(state.anchor) ? state.anchor : (state.tiles[0]?.key ?? null));
  }, []);

  return {
    setCuts,
    setLabels,
    scrollToTile,
    selectAndReveal,
    updateSelected,
    rotateSelected,
    deleteSelected,
    deleteRelative,
    reverseAll,
    duplicateSelected,
    insertAtSelection,
    replaceSelection,
    moveSelection,
    nudgeSelected,
    moveSelectedTo,
    toggleCutsAtSelection,
    toggleCutAt,
    focusTileKey,
  };
}

export type OrganizerEdits = ReturnType<typeof useOrganizerEdits>;

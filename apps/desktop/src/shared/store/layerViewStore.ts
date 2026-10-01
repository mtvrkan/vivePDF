import { create } from "zustand";
import type { LayerChoice, LayerRow } from "@/types";

export type LayerList = { state: "loading" } | { state: "failed" } | { state: "listed"; rows: LayerRow[] };

type LayerViewState = {
  lists: Record<string, LayerList>;
  choices: Record<string, Record<number, boolean>>;
  setList: (documentId: string, list: LayerList) => void;
  setChoices: (path: string, choices: Record<number, boolean>) => void;
  forgetList: (documentId: string) => void;
  clearChoices: (path: string) => void;
};

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export const useLayerViewStore = create<LayerViewState>((set) => ({
  lists: {},
  choices: {},
  setList: (documentId, list) => set((state) => ({ lists: { ...state.lists, [documentId]: list } })),
  setChoices: (path, choices) => set((state) => ({ choices: Object.keys(choices).length > 0 ? { ...state.choices, [path]: choices } : without(state.choices, path) })),
  forgetList: (documentId) => set((state) => ({ lists: without(state.lists, documentId) })),
  clearChoices: (path) => set((state) => ({ choices: without(state.choices, path) })),
}));

export function hasLayers(list: LayerList | undefined): boolean {
  return list?.state === "listed" && list.rows.some((row) => row.kind === "layer");
}

export function layerShown(row: LayerRow, choices: Record<number, boolean> | undefined): boolean {
  if (row.id === null) return false;
  return choices?.[row.id] ?? row.on;
}

export function chooseLayer(rows: LayerRow[], choices: Record<number, boolean> | undefined, id: number, on: boolean): Record<number, boolean> {
  const next = { ...choices };
  const row = rows.find((entry) => entry.id === id);
  if (row && row.on === on) delete next[id];
  else next[id] = on;
  return next;
}

export function layerChoiceList(choices: Record<number, boolean> | undefined): LayerChoice[] {
  return Object.entries(choices ?? {}).map(([id, on]) => ({ id: Number(id), on }));
}

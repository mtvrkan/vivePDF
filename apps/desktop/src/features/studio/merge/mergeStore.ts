import { useMemo } from "react";
import { create } from "zustand";
import { toRpcError } from "@/shared/rpc/client";
import { previewFormData } from "@/shared/rpc/operations";
import type { DataPreviewResult, RpcError } from "@/types";

export const PREVIEW_ROWS = 50;

type MergeState = {
  dataPath: string | null;
  sheet: string | null;
  table: DataPreviewResult | null;
  loading: boolean;
  error: RpcError | null;
  row: number;
  showValues: boolean;
  connect: (path: string, sheet?: string | null) => Promise<void>;
  reload: () => Promise<void>;
  clear: () => void;
  setRow: (row: number) => void;
  setShowValues: (show: boolean) => void;
};

let request = 0;

export const useMergeStore = create<MergeState>((set, get) => ({
  dataPath: null,
  sheet: null,
  table: null,
  loading: false,
  error: null,
  row: 0,
  showValues: false,
  connect: async (path, sheet = null) => {
    const ticket = ++request;
    set({ dataPath: path, sheet, loading: true, error: null, row: 0 });
    try {
      const table = await previewFormData({ path, sheet: sheet ?? undefined, limit: PREVIEW_ROWS });
      if (ticket === request) set({ table, loading: false, showValues: table.totalRows > 0 });
    } catch (error) {
      if (ticket === request) set({ table: null, loading: false, error: toRpcError(error), showValues: false });
    }
  },
  reload: async () => {
    const { dataPath, sheet } = get();
    if (dataPath) await get().connect(dataPath, sheet);
  },
  clear: () => {
    request += 1;
    set({ dataPath: null, sheet: null, table: null, loading: false, error: null, row: 0, showValues: false });
  },
  setRow: (row) => {
    const rows = get().table?.rows.length ?? 0;
    set({ row: Math.min(Math.max(0, row), Math.max(0, rows - 1)) });
  },
  setShowValues: (showValues) => set({ showValues }),
}));

export function previewValues(state: Pick<MergeState, "table" | "row" | "showValues">, date: string): Record<string, string> | null {
  if (!state.showValues || !state.table) return null;
  const row = state.table.rows[state.row];
  if (!row) return null;
  return { n: String(state.row + 1), date, ...row };
}

export function usePreviewValues(language: string): Record<string, string> | null {
  const table = useMergeStore((state) => state.table);
  const row = useMergeStore((state) => state.row);
  const showValues = useMergeStore((state) => state.showValues);
  return useMemo(() => previewValues({ table, row, showValues }, new Date().toLocaleDateString(language)), [table, row, showValues, language]);
}

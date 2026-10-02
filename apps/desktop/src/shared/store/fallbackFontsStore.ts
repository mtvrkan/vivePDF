import { create } from "zustand";
import type { RpcError, RpcProgress } from "@/types";

export type FontDownload = { state: "downloading"; progress: RpcProgress | null } | { state: "failed"; error: RpcError } | { state: "installed" };

type FallbackFontsState = {
  missing: Record<string, string[]>;
  dismissed: Record<string, string[]>;
  downloads: Record<string, FontDownload>;
  noteMissing: (documentId: string, set: string) => void;
  dismiss: (documentId: string, set: string) => void;
  setDownload: (set: string, download: FontDownload | null) => void;
  forget: (documentId: string) => void;
};

function withEntry(record: Record<string, string[]>, key: string, value: string): Record<string, string[]> {
  const current = record[key] ?? [];
  return current.includes(value) ? record : { ...record, [key]: [...current, value] };
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export const useFallbackFontsStore = create<FallbackFontsState>((set) => ({
  missing: {},
  dismissed: {},
  downloads: {},
  noteMissing: (documentId, fontSet) =>
    set((state) => {
      const missing = withEntry(state.missing, documentId, fontSet);
      return missing === state.missing ? state : { missing };
    }),
  dismiss: (documentId, fontSet) =>
    set((state) => {
      const dismissed = withEntry(state.dismissed, documentId, fontSet);
      return dismissed === state.dismissed ? state : { dismissed };
    }),
  setDownload: (fontSet, download) =>
    set((state) => ({ downloads: download ? { ...state.downloads, [fontSet]: download } : without(state.downloads, fontSet) })),
  forget: (documentId) =>
    set((state) => ({ missing: without(state.missing, documentId), dismissed: without(state.dismissed, documentId) })),
}));

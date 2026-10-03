import { create } from "zustand";
import type { FieldBox, SignatureInfo } from "@/types";

export type SignatureCheck = { state: "loading" } | { state: "none" } | { state: "failed" } | { state: "checked"; signatures: SignatureInfo[] };
export type FieldHighlight = { state: "loading" } | { state: "failed" } | { state: "shown"; boxes: FieldBox[] };
export type DocumentMessage = "signatures" | "forms" | "converted";

type DocumentMessagesState = {
  signatures: Record<string, SignatureCheck>;
  highlights: Record<string, FieldHighlight>;
  dismissed: Record<string, DocumentMessage[]>;
  setSignatures: (documentId: string, check: SignatureCheck) => void;
  setHighlight: (documentId: string, highlight: FieldHighlight | null) => void;
  dismiss: (documentId: string, message: DocumentMessage) => void;
  forget: (documentId: string) => void;
};

function without<T>(record: Record<string, T>, documentId: string): Record<string, T> {
  if (!(documentId in record)) return record;
  const next = { ...record };
  delete next[documentId];
  return next;
}

export const useDocumentMessagesStore = create<DocumentMessagesState>((set) => ({
  signatures: {},
  highlights: {},
  dismissed: {},
  setSignatures: (documentId, check) => set((state) => ({ signatures: { ...state.signatures, [documentId]: check } })),
  setHighlight: (documentId, highlight) =>
    set((state) => ({ highlights: highlight ? { ...state.highlights, [documentId]: highlight } : without(state.highlights, documentId) })),
  dismiss: (documentId, message) =>
    set((state) => {
      const current = state.dismissed[documentId] ?? [];
      return current.includes(message) ? state : { dismissed: { ...state.dismissed, [documentId]: [...current, message] } };
    }),
  forget: (documentId) =>
    set((state) => ({
      signatures: without(state.signatures, documentId),
      highlights: without(state.highlights, documentId),
      dismissed: without(state.dismissed, documentId),
    })),
}));

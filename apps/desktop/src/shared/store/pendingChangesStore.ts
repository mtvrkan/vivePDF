import { create } from "zustand";
import type { BookmarkItem, ReviewState } from "@/types";

export type PendingChange =
  | { id: string; kind: "commentResolved"; xrefs: number[]; resolved: boolean; label: string }
  | { id: string; kind: "commentDeleted"; xrefs: number[]; label: string }
  | { id: string; kind: "commentState"; xrefs: number[]; state: ReviewState | null; label: string }
  | { id: string; kind: "commentReply"; parent: number; content: string; label: string }
  | { id: string; kind: "attachmentAdded"; files: string[]; label: string }
  | { id: string; kind: "attachmentRemoved"; names: string[]; label: string }
  | { id: string; kind: "bookmarkAdded"; title: string; page: number; x?: number; y?: number; label: string }
  | { id: string; kind: "metadataChanged"; metadata: { title: string; author: string; subject: string; keywords: string }; label: string }
  | { id: string; kind: "outlineReplaced"; items: BookmarkItem[]; label: string }
  | { id: string; kind: "formFilled"; values: Record<string, string | boolean | string[]>; label: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type PendingChangeInput = DistributiveOmit<PendingChange, "id">;

type PendingChangesState = {
  changes: Record<string, PendingChange[]>;
  queue: (documentId: string, change: PendingChangeInput) => void;
  replace: (documentId: string, change: PendingChangeInput) => void;
  drop: (documentId: string, changeId: string) => void;
  clear: (documentId: string) => void;
};

export const usePendingChangesStore = create<PendingChangesState>((set) => ({
  changes: {},
  queue: (documentId, change) =>
    set((state) => ({
      changes: { ...state.changes, [documentId]: [...(state.changes[documentId] ?? []), { ...change, id: crypto.randomUUID() } as PendingChange] },
    })),
  replace: (documentId, change) =>
    set((state) => {
      const current = state.changes[documentId] ?? [];
      const index = current.findIndex((entry) => entry.kind === change.kind);
      const next = index < 0 ? [...current, { ...change, id: crypto.randomUUID() } as PendingChange] : current.map((entry, position) => (position === index ? ({ ...change, id: entry.id } as PendingChange) : entry));
      return { changes: { ...state.changes, [documentId]: next } };
    }),
  drop: (documentId, changeId) =>
    set((state) => {
      const current = state.changes[documentId];
      if (!current) return state;
      return { changes: { ...state.changes, [documentId]: current.filter((entry) => entry.id !== changeId) } };
    }),
  clear: (documentId) =>
    set((state) => {
      if (!(documentId in state.changes)) return state;
      const next = { ...state.changes };
      delete next[documentId];
      return { changes: next };
    }),
}));

const NO_CHANGES: PendingChange[] = [];

export function pendingChangesFor(changes: Record<string, PendingChange[]>, documentId: string): PendingChange[] {
  return changes[documentId] ?? NO_CHANGES;
}

export function resolvedOverride(changes: PendingChange[], xref: number): boolean | null {
  const override = reviewStateOverride(changes, xref);
  return override === null ? null : override.state === "Completed";
}

export function reviewStateOverride(changes: PendingChange[], xref: number): { state: ReviewState | null } | null {
  let value: { state: ReviewState | null } | null = null;
  for (const change of changes) {
    if (change.kind === "commentResolved" && change.xrefs.includes(xref)) value = { state: change.resolved ? "Completed" : null };
    else if (change.kind === "commentState" && change.xrefs.includes(xref)) value = { state: change.state };
  }
  return value;
}

export function pendingReplies(changes: PendingChange[]): Extract<PendingChange, { kind: "commentReply" }>[] {
  return changes.filter((change): change is Extract<PendingChange, { kind: "commentReply" }> => change.kind === "commentReply");
}

export function isCommentDeleted(changes: PendingChange[], xref: number): boolean {
  return changes.some((change) => change.kind === "commentDeleted" && change.xrefs.includes(xref));
}

export function isAttachmentRemoved(changes: PendingChange[], name: string): boolean {
  return changes.some((change) => change.kind === "attachmentRemoved" && change.names.includes(name));
}

export function addedAttachmentNames(changes: PendingChange[]): string[] {
  return changes.flatMap((change) => (change.kind === "attachmentAdded" ? change.files : []));
}

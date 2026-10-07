import { pendingChangesFor, usePendingChangesStore, type PendingChange } from "@/shared/store/pendingChangesStore";
import type { PageTurn } from "@/types";

export type PageEdits = { deleted: number[]; rotations: Record<number, number> };

type PagesEdited = Extract<PendingChange, { kind: "pagesEdited" }>;

export const NO_PAGE_EDITS: PageEdits = { deleted: [], rotations: {} };

export function pendingPageEdits(changes: PendingChange[]): PagesEdited | null {
  return changes.find((change): change is PagesEdited => change.kind === "pagesEdited") ?? null;
}

export function normalizedTurn(degrees: number): number {
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
}

export function isPageDeleted(edits: PageEdits, pageIndex: number): boolean {
  return edits.deleted.includes(pageIndex);
}

export function pageRotation(edits: PageEdits, pageIndex: number): number {
  return normalizedTurn(edits.rotations[pageIndex] ?? 0);
}

export function canDeletePage(edits: PageEdits, pageIndex: number, pageCount: number): boolean {
  if (isPageDeleted(edits, pageIndex)) return true;
  return edits.deleted.length + 1 < pageCount;
}

export function toggleDeleted(edits: PageEdits, pageIndex: number, pageCount: number): PageEdits | null {
  if (isPageDeleted(edits, pageIndex)) return { ...edits, deleted: edits.deleted.filter((page) => page !== pageIndex) };
  if (!canDeletePage(edits, pageIndex, pageCount)) return null;
  return { ...edits, deleted: [...edits.deleted, pageIndex].sort((a, b) => a - b) };
}

export function rotatePage(edits: PageEdits, pageIndex: number, delta: 90 | -90): PageEdits {
  const next = normalizedTurn(pageRotation(edits, pageIndex) + delta);
  const rotations = { ...edits.rotations };
  if (next === 0) delete rotations[pageIndex];
  else rotations[pageIndex] = next;
  return { ...edits, rotations };
}

export function pageEditCount(edits: PageEdits): number {
  const rotated = Object.keys(edits.rotations).filter((key) => pageRotation(edits, Number(key)) !== 0 && !edits.deleted.includes(Number(key)));
  return edits.deleted.length + rotated.length;
}

export function pageTurns(edits: PageEdits): PageTurn[] {
  return Object.keys(edits.rotations)
    .map(Number)
    .filter((page) => pageRotation(edits, page) !== 0 && !edits.deleted.includes(page))
    .sort((a, b) => a - b)
    .map((page) => ({ page, rotate: pageRotation(edits, page) as PageTurn["rotate"] }));
}

export function orderedForSave(changes: PendingChange[]): PendingChange[] {
  return [...changes.filter((change) => change.kind !== "pagesEdited"), ...changes.filter((change) => change.kind === "pagesEdited")];
}

export function storePageEdits(documentId: string, edits: PageEdits, label: string): void {
  const store = usePendingChangesStore.getState();
  const current = pendingPageEdits(pendingChangesFor(store.changes, documentId));
  if (pageEditCount(edits) > 0) {
    store.replace(documentId, { kind: "pagesEdited", deleted: edits.deleted, rotations: edits.rotations, label });
    return;
  }
  if (current) store.drop(documentId, current.id);
}

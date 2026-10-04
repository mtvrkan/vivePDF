import type { StudioElement } from "@/types/studio";
import { alignElements, distributeElements, groupElements, moveElements, reorderElements, ungroupElements, updateElement, type AlignMode, type ReorderDirection } from "../model/edit";
import { flipElements, type FlipAxis } from "../model/flip";
import { currentPage, selectedElements, useStudioStore } from "./studioStore";

const store = () => useStudioStore.getState();

export function selectAll() {
  const page = currentPage(store());
  if (page) store().select(page.elements.filter((element) => !element.hidden).map((element) => element.id));
}

export function nudge(dx: number, dy: number) {
  const { selection } = store();
  if (selection.length) store().applyToPage((page) => moveElements(page, selection, dx, dy), { merge: "nudge" });
}

export function align(mode: AlignMode) {
  const { selection } = store();
  if (selection.length) store().applyToPage((page) => alignElements(page, selection, mode, selection.length > 1 ? "selection" : "page"));
}

export function distribute(axis: "horizontal" | "vertical") {
  const { selection } = store();
  store().applyToPage((page) => distributeElements(page, selection, axis));
}

export function reorder(direction: ReorderDirection) {
  const { selection } = store();
  if (selection.length) store().applyToPage((page) => reorderElements(page, selection, direction));
}

export function group() {
  const { selection } = store();
  store().applyToPage((page) => groupElements(page, selection).page);
}

export function ungroup() {
  const { selection } = store();
  store().applyToPage((page) => ungroupElements(page, selection));
}

export function canGroup(): boolean {
  const elements = selectedElements(store());
  return elements.length > 1 && new Set(elements.map((element) => element.groupId ?? element.id)).size > 1;
}

export function canUngroup(): boolean {
  return selectedElements(store()).some((element) => element.groupId !== null);
}

export function toggleLock() {
  const elements = selectedElements(store());
  if (!elements.length) return;
  const locked = !elements.every((element) => element.locked);
  store().applyToPage((page) => elements.reduce((current, element) => updateElement<StudioElement>(current, element.id, { locked }), page));
}

export function flipSelection(axis: FlipAxis) {
  const { selection } = store();
  if (selection.length) store().applyToPage((page) => flipElements(page, selection, axis));
}

export function toggleHiddenSelection() {
  const elements = selectedElements(store());
  if (!elements.length) return;
  const hidden = !elements.every((element) => element.hidden);
  store().applyToPage((page) => elements.reduce((current, element) => updateElement<StudioElement>(current, element.id, { hidden }), page));
}

export function patchSelected(patch: Partial<StudioElement> | ((element: StudioElement) => Partial<StudioElement>), merge?: string) {
  const elements = selectedElements(store());
  if (!elements.length) return;
  store().applyToPage(
    (page) => elements.reduce((current, element) => updateElement<StudioElement>(current, element.id, typeof patch === "function" ? patch(element) : patch), page),
    merge ? { merge } : undefined,
  );
}

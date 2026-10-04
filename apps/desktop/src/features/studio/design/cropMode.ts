import { create } from "zustand";
import type { StudioElement, StudioImageElement } from "@/types/studio";
import { updateElement } from "../model/edit";
import { loadImagePreview } from "./assets";
import { finishDraft, initialDraft, type CropDraft, type Size } from "./cropMath";
import { currentPage, selectedElements, useStudioStore } from "./studioStore";

export type CropSession = { elementId: string; pageId: string; natural: Size; draft: CropDraft };

type CropState = { session: CropSession | null };

export const useCropStore = create<CropState>(() => ({ session: null }));

export function croppable(element: StudioElement | undefined): element is StudioImageElement {
  return element?.kind === "image" && Boolean(element.src) && !element.locked && !element.hidden;
}

export function isCropping(): boolean {
  return useCropStore.getState().session !== null;
}

function findElement(id: string): { element: StudioElement | undefined; pageId: string | null } {
  const page = currentPage(useStudioStore.getState());
  return { element: page?.elements.find((item) => item.id === id), pageId: page?.id ?? null };
}

export async function beginCrop(target?: StudioElement): Promise<boolean> {
  const state = useStudioStore.getState();
  const selected = selectedElements(state);
  const element = target ?? (selected.length === 1 ? selected[0] : undefined);
  if (!croppable(element)) return false;
  const preview = await loadImagePreview(element.src);
  const fresh = findElement(element.id);
  if (!preview || !croppable(fresh.element) || fresh.element.src !== element.src || !fresh.pageId) return false;
  const natural = { width: preview.width, height: preview.height };
  const store = useStudioStore.getState();
  store.setEditing(null);
  store.select([element.id]);
  useCropStore.setState({ session: { elementId: element.id, pageId: fresh.pageId, natural, draft: initialDraft(natural, fresh.element) } });
  return true;
}

export function updateDraft(change: (draft: CropDraft, session: CropSession) => CropDraft) {
  const session = useCropStore.getState().session;
  if (session) useCropStore.setState({ session: { ...session, draft: change(session.draft, session) } });
}

export function cancelCrop() {
  if (useCropStore.getState().session) useCropStore.setState({ session: null });
}

function unchanged(element: StudioImageElement, patch: ReturnType<typeof finishDraft>): boolean {
  return (
    element.x === patch.x &&
    element.y === patch.y &&
    element.width === patch.width &&
    element.height === patch.height &&
    element.fit === patch.fit &&
    element.crop.x === patch.crop.x &&
    element.crop.y === patch.crop.y &&
    element.crop.width === patch.crop.width &&
    element.crop.height === patch.crop.height
  );
}

export function applyCrop() {
  const session = useCropStore.getState().session;
  if (!session) return;
  useCropStore.setState({ session: null });
  const found = findElement(session.elementId);
  if (found.pageId !== session.pageId || found.element?.kind !== "image") return;
  const patch = finishDraft(session.draft);
  if (unchanged(found.element, patch)) return;
  useStudioStore.getState().applyToPage((page) => updateElement<StudioImageElement>(page, session.elementId, patch));
}

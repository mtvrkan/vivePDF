import type { MouseEvent as ReactMouseEvent } from "react";
import type { StudioPage } from "@/types/studio";
import { openGraphic } from "../graphics/graphicEditor";
import { removeGuide } from "../model/guides";
import { beginCrop, croppable } from "./cropMode";
import { textEditorEntry } from "./textEditorBridge";
import { useStudioStore } from "./studioStore";

export function openOnDoubleClick(event: ReactMouseEvent, page: StudioPage) {
  const store = () => useStudioStore.getState();
  const guide = (event.target as HTMLElement).closest<HTMLElement>("[data-guide]");
  if (guide) {
    const index = Number(guide.dataset.guide);
    store().applyToPage((current) => removeGuide(current, index));
    return;
  }
  const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
  const element = page.elements.find((item) => item.id === hit);
  const state = store();
  if (element && element.groupId !== null && !(state.groupScope === element.groupId && state.selection.includes(element.id))) {
    state.enterGroup(element.id);
    return;
  }
  if (element && openGraphic(element, { x: event.clientX, y: event.clientY })) return;
  if (element?.kind === "text" && !element.locked) {
    store().select([element.id]);
    textEditorEntry.point = { x: event.clientX, y: event.clientY };
    store().setEditing(element.id);
  }
  if (croppable(element)) void beginCrop(element);
}

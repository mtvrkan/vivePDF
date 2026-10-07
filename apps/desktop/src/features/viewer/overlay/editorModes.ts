import { Crop, Link2, Ruler, Signature, SquareDashed, type LucideIcon } from "lucide-react";
import { EDITOR_MODES, useViewerOverlayStore, type OverlayMode } from "@/shared/store/viewerOverlayStore";
import { isPendingChange } from "./pending";

export const PAGE_TOOLS: Array<{ mode: OverlayMode; icon: LucideIcon; labelKey: string }> = [
  { mode: "signature", icon: Signature, labelKey: "viewer.overlay.signature" },
  { mode: "link", icon: Link2, labelKey: "viewer.overlay.link" },
  { mode: "redact", icon: SquareDashed, labelKey: "viewer.overlay.redact" },
  { mode: "crop", icon: Crop, labelKey: "viewer.overlay.crop" },
  { mode: "measure", icon: Ruler, labelKey: "viewer.overlay.measure" },
];

function isEditorMode(mode: OverlayMode | null): boolean {
  return mode !== null && EDITOR_MODES.includes(mode);
}

export function isEditingMode(mode: OverlayMode | null): boolean {
  return isEditorMode(mode) || PAGE_TOOLS.some((tool) => tool.mode === mode);
}

export function switchOverlayMode(target: OverlayMode | null) {
  const state = useViewerOverlayStore.getState();
  if (target === state.mode) return;
  const leavingEditor = isEditorMode(state.mode) && !isEditorMode(target);
  if (leavingEditor) state.requestLeave(() => state.setMode(target), state.objects.filter(isPendingChange).length > 0);
  else state.setMode(target);
}

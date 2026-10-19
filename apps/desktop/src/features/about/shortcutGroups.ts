import { ORGANIZER_SHORTCUTS } from "@/features/pages/organizerShortcuts";
import { DOCUMENT_SHORTCUTS, STUDIO_SHORTCUT_GROUPS } from "@/features/studio/design/shortcutList";
import { FIND_AGAIN_KEYS, HISTORY_KEYS } from "@/features/viewer/navigationKeys";
import type { TFunction } from "i18next";
import { FULLSCREEN_SHORTCUT, shortcutLabel } from "@/shared/lib/platform";

export type ShortcutGroup = { id: string; items: Array<{ keys: string; labelKey: string }> };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "global",
    items: [
      { keys: "Ctrl O", labelKey: "about.shortcuts.items.open" },
      { keys: "Ctrl Shift N", labelKey: "about.shortcuts.items.newWindow" },
      { keys: "Ctrl Shift V", labelKey: "about.shortcuts.items.clipboard" },
      { keys: "Ctrl K", labelKey: "about.shortcuts.items.palette" },
      { keys: "F1  /  Ctrl /", labelKey: "about.shortcuts.items.shortcutSheet" },
      { keys: "Shift F1", labelKey: "about.shortcuts.items.helpTopic" },
      { keys: "Ctrl W", labelKey: "about.shortcuts.items.closeDocument" },
      { keys: "Esc", labelKey: "about.shortcuts.items.closeDialog" },
    ],
  },
  {
    id: "viewer",
    items: [
      { keys: "Ctrl F", labelKey: "about.shortcuts.items.search" },
      { keys: FIND_AGAIN_KEYS, labelKey: "about.shortcuts.items.searchNext" },
      { keys: "Ctrl Shift C", labelKey: "about.shortcuts.items.copyAsCode" },
      { keys: "Ctrl P", labelKey: "about.shortcuts.items.print" },
      { keys: FULLSCREEN_SHORTCUT, labelKey: "about.shortcuts.items.fullscreen" },
      { keys: "Ctrl +  /  Ctrl −  /  Ctrl Wheel", labelKey: "about.shortcuts.items.zoom" },
      { keys: "Ctrl 0  /  Ctrl 1  /  Ctrl 2", labelKey: "about.shortcuts.items.zoomModes" },
      { keys: "Space + Drag  ·  Middle Drag", labelKey: "about.shortcuts.items.panDrag" },
      { keys: "PgUp / PgDn  ·  ← →", labelKey: "about.shortcuts.items.pages" },
      { keys: "Home / End", labelKey: "about.shortcuts.items.firstLast" },
      { keys: HISTORY_KEYS, labelKey: "about.shortcuts.items.navigateHistory" },
      { keys: "Delete", labelKey: "about.shortcuts.items.deleteAnnotation" },
      { keys: "Ctrl Z  /  Ctrl Y", labelKey: "about.shortcuts.items.undoRedoViewer" },
      { keys: "Ctrl Shift H", labelKey: "about.shortcuts.items.autoScroll" },
      { keys: "Ctrl Shift E", labelKey: "about.shortcuts.items.splitView" },
      { keys: "↑ ↓  ·  −  ·  Esc", labelKey: "about.shortcuts.items.autoScrollControl" },
    ],
  },
  {
    id: "editor",
    items: [
      { keys: "Delete / Backspace", labelKey: "about.shortcuts.items.editDelete" },
      { keys: "Enter", labelKey: "about.shortcuts.items.editEnter" },
      { keys: "Esc", labelKey: "about.shortcuts.items.editEscape" },
      { keys: "Ctrl S  /  Ctrl Shift S", labelKey: "about.shortcuts.items.editSave" },
      { keys: "Ctrl B  /  Ctrl I", labelKey: "about.shortcuts.items.editStyle" },
      { keys: "Ctrl D", labelKey: "about.shortcuts.items.editDuplicate" },
      { keys: "Ctrl C  /  Ctrl X  /  Ctrl V", labelKey: "about.shortcuts.items.editClipboard" },
      { keys: "Tab  /  Shift Tab", labelKey: "about.shortcuts.items.editCycle" },
      { keys: "← → ↑ ↓  ·  Shift", labelKey: "about.shortcuts.items.editNudge" },
    ],
  },
  {
    id: "presentation",
    items: [
      { keys: FULLSCREEN_SHORTCUT, labelKey: "about.shortcuts.items.presentationEnter" },
      { keys: "F5  /  Shift F5", labelKey: "about.shortcuts.items.presentationStart" },
      { keys: "Alt F5  /  Alt Shift F5", labelKey: "about.shortcuts.items.presenterView" },
      { keys: "L", labelKey: "about.shortcuts.items.presentationLaser" },
      { keys: "P", labelKey: "about.shortcuts.items.presentationPen" },
      { keys: "H", labelKey: "about.shortcuts.items.presentationHighlighter" },
      { keys: "E", labelKey: "about.shortcuts.items.presentationEraser" },
      { keys: "S", labelKey: "about.shortcuts.items.presentationSpotlight" },
      { keys: "M", labelKey: "about.shortcuts.items.presentationMagnifier" },
      { keys: "U", labelKey: "about.shortcuts.items.presentationRuler" },
      { keys: "V  /  Del", labelKey: "about.shortcuts.items.presentationSelectDrawing" },
      { keys: "R  /  Shift R  ·  Ctrl D", labelKey: "about.shortcuts.items.presentationDrawingEdit" },
      { keys: "Z", labelKey: "about.shortcuts.items.presentationZoomArea" },
      { keys: "B  /  W  /  .", labelKey: "about.shortcuts.items.presentationBlackout" },
      { keys: "G", labelKey: "about.shortcuts.items.presentationOverview" },
      { keys: "K", labelKey: "about.shortcuts.items.presentationCodeBlocks" },
      { keys: "T  /  C", labelKey: "about.shortcuts.items.presentationTimerClock" },
      { keys: "N", labelKey: "about.shortcuts.items.presentationNotes" },
      { keys: "Ctrl Z  /  Ctrl Y", labelKey: "about.shortcuts.items.presentationUndoRedo" },
      { keys: "Esc", labelKey: "about.shortcuts.items.presentationEscape" },
    ],
  },
  { id: "organizer", items: ORGANIZER_SHORTCUTS },
  { id: "studio", items: STUDIO_SHORTCUT_GROUPS.flatMap((group) => group.items) },
  { id: "studioDocument", items: DOCUMENT_SHORTCUTS },
];

export function splitKeys(keys: string): string[] {
  return keys.split(/\s+[/·]\s+/).filter(Boolean);
}

export function keyCombos(keys: string, t: TFunction): string[] {
  return splitKeys(shortcutLabel(keys).replace(/\{(\w+)\}/g, (_, gesture: string) => t(`tools.pages.gesture.${gesture}`)));
}

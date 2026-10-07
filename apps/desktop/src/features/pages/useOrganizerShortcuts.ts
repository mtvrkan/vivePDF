import { useEffect, useLayoutEffect, useRef } from "react";
import type { GridBox } from "./gridGeometry";
import { useOrganizerStore } from "./organizerStore";
import type { OrganizerEdits } from "./useOrganizerEdits";

export type ShortcutCommands = {
  openRange: () => void;
  openMove: () => void;
  openPreview: (key: string) => void;
  openMenu: (key: string, x: number, y: number) => void;
  openBlank: () => void;
  openShortcuts: () => void;
  extractSelection: () => void;
  applyAll: () => void;
  zoomBy: (delta: number) => void;
  copyPages: () => void;
  cutPages: () => void;
  pastePages: () => void;
};

export type ShortcutLayout = {
  columns: () => number;
  clientBoxOf: (index: number) => GridBox | null;
};

type UseOrganizerShortcutsOptions = {
  enabled: boolean;
  layout: ShortcutLayout;
  edits: OrganizerEdits;
  commands: ShortcutCommands;
};

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']") !== null;
}

export function isMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[role='menu'], [data-context-menu-layer]") !== null;
}

export function isActivatableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a[href], summary, [role='button'], [role='menuitem'], [role='tab'], [role='checkbox'], [role='switch']") !== null;
}

export function useOrganizerShortcuts({ enabled, layout, edits, commands }: UseOrganizerShortcutsOptions) {
  const latest = useRef({ edits, commands, layout });
  useLayoutEffect(() => {
    latest.current = { edits, commands, layout };
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target) || isMenuTarget(event.target)) return;
      const { edits: current, commands: run, layout: grid } = latest.current;
      const { undo, redo, select } = useOrganizerStore.getState();
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        redo();
      } else if (mod && key === "a") {
        event.preventDefault();
        select(useOrganizerStore.getState().tiles.map((tile) => tile.key));
      } else if (mod && !event.shiftKey && key === "i") {
        event.preventDefault();
        current.invertSelection();
      } else if (mod && key === "d") {
        event.preventDefault();
        current.duplicateSelected();
      } else if (mod && !event.shiftKey && key === "c") {
        event.preventDefault();
        run.copyPages();
      } else if (mod && !event.shiftKey && key === "x") {
        event.preventDefault();
        run.cutPages();
      } else if (mod && !event.shiftKey && key === "v") {
        event.preventDefault();
        run.pastePages();
      } else if (mod && key === "g") {
        event.preventDefault();
        run.openRange();
      } else if (!mod && !event.altKey && !event.shiftKey && (event.key === " " || key === "enter") && !isActivatableTarget(event.target)) {
        event.preventDefault();
        const focused = current.focusTileKey();
        if (focused) run.openPreview(focused);
      } else if (key === "contextmenu" || (event.shiftKey && key === "f10")) {
        event.preventDefault();
        const focused = current.focusTileKey();
        if (focused) current.scrollToTile(focused);
        const rect = focused ? grid.clientBoxOf(useOrganizerStore.getState().tiles.findIndex((tile) => tile.key === focused)) : null;
        if (focused && rect) run.openMenu(focused, rect.left + rect.width / 2, rect.top + rect.height / 2);
      } else if (mod && key === "e") {
        event.preventDefault();
        if (useOrganizerStore.getState().selected.size > 0) run.extractSelection();
      } else if (key === "s" && !mod && !event.altKey) {
        event.preventDefault();
        if (event.shiftKey) current.setCuts(new Set());
        else current.toggleCutsAtSelection();
      } else if (key === "b" && !mod && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        run.openBlank();
      } else if (event.key === "?") {
        event.preventDefault();
        run.openShortcuts();
      } else if (event.altKey && !mod && (key === "arrowleft" || key === "arrowright" || key === "arrowup" || key === "arrowdown" || key === "home" || key === "end")) {
        event.preventDefault();
        const step = key === "arrowleft" || key === "arrowright" ? 1 : key === "home" || key === "end" ? useOrganizerStore.getState().tiles.length : grid.columns();
        current.nudgeSelected(key === "arrowleft" || key === "arrowup" || key === "home" ? -step : step);
      } else if (key === "m" && !mod && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (useOrganizerStore.getState().selected.size > 0) run.openMove();
      } else if (key === "home" || key === "end") {
        event.preventDefault();
        const total = useOrganizerStore.getState().tiles.length;
        current.moveSelection(key === "home" ? -total : total, event.shiftKey);
      } else if (mod && key === "enter") {
        event.preventDefault();
        run.applyAll();
      } else if (mod && !event.altKey && (key === "+" || key === "=" || key === "-")) {
        event.preventDefault();
        run.zoomBy(key === "-" ? -30 : 30);
      } else if (key === "delete" || key === "backspace") {
        event.preventDefault();
        current.deleteSelected();
      } else if (key === "escape") {
        select([]);
      } else if (key === "r" && !mod) {
        event.preventDefault();
        current.rotateSelected(event.shiftKey ? -90 : 90);
      } else if (key === "arrowleft" || key === "arrowright") {
        event.preventDefault();
        current.moveSelection(key === "arrowleft" ? -1 : 1, event.shiftKey);
      } else if (key === "arrowup" || key === "arrowdown") {
        event.preventDefault();
        const columns = grid.columns();
        current.moveSelection(key === "arrowup" ? -columns : columns, event.shiftKey);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

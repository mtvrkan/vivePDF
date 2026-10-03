import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { group, nudge, patchSelected, reorder, selectAll, ungroup } from "./commands";
import { withElementStyle } from "./richText";
import { selectedElements, useStudioStore } from "./studioStore";

const NUDGE = 1;
const NUDGE_FAR = 10;
const ZOOM_STEP = 1.25;
const STYLE_KEYS: Record<string, "bold" | "italic" | "underline"> = { b: "bold", i: "italic", u: "underline" };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function useStudioShortcuts(onExport: () => void) {
  const exportRef = useRef(onExport);
  exportRef.current = onExport;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      const state = useStudioStore.getState();
      if (!state.design) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (mod && key === "z" && !event.shiftKey) return run(state.undo);
      if (mod && (key === "y" || (key === "z" && event.shiftKey))) return run(state.redo);
      if (mod && key === "c" && !event.shiftKey) return run(state.copy);
      if (mod && key === "x") return run(state.cut);
      if (mod && key === "v" && !event.shiftKey) return run(state.paste);
      if (mod && key === "d") return run(state.duplicate);
      if (mod && key === "a") return run(selectAll);
      if (mod && key === "g") return run(event.shiftKey ? ungroup : group);
      if (mod && key === "e") return run(exportRef.current);
      if (mod && (key === "]" || key === "}")) return run(() => reorder(event.shiftKey ? "front" : "forward"));
      if (mod && (key === "[" || key === "{")) return run(() => reorder(event.shiftKey ? "back" : "backward"));
      if (mod && (key === "=" || key === "+")) return run(() => state.setZoom(state.zoom * ZOOM_STEP));
      if (mod && key === "-") return run(() => state.setZoom(state.zoom / ZOOM_STEP));
      if (mod && key === "0") return run(state.setFit);
      const style = STYLE_KEYS[key];
      if (mod && style && !event.shiftKey) {
        const texts = selectedElements(state).filter((element) => element.kind === "text");
        if (!texts.length) return;
        const next = !texts.every((element) => element.kind === "text" && element[style]);
        return run(() => patchSelected((element) => (element.kind === "text" ? withElementStyle(element, { [style]: next }) : {})));
      }
      if (mod) return;
      if (event.key === "Delete" || event.key === "Backspace") return run(state.remove);
      if (event.key === "Escape" && state.selection.length) return run(() => state.select([]));
      if (event.key === "Enter") {
        const [only] = selectedElements(state);
        if (only?.kind === "text" && state.selection.length === 1 && !only.locked) return run(() => state.setEditing(only.id));
        return;
      }
      const arrow = ARROWS[event.key];
      if (arrow && state.selection.length) {
        const step = event.shiftKey ? NUDGE_FAR : NUDGE;
        run(() => nudge(arrow[0] * step, arrow[1] * step));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

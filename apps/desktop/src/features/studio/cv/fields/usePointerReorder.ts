import { useState, type PointerEvent as ReactPointerEvent } from "react";

export type ReorderDrag = { from: number; to: number };

function targetIndex(list: Element, clientY: number): number {
  const rows = [...list.querySelectorAll(":scope > [data-reorder-index]")];
  for (const [index, row] of rows.entries()) {
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return index;
  }
  return rows.length;
}

export function usePointerReorder(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<ReorderDrag | null>(null);

  const begin = (from: number) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    const list = handle.closest("[data-reorder-list]");
    if (!list) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    let to = from;
    setDrag({ from, to });
    const move = (moveEvent: PointerEvent) => {
      const target = targetIndex(list, moveEvent.clientY);
      const next = target > from ? target - 1 : target;
      if (next === to) return;
      to = next;
      setDrag({ from, to });
    };
    const finish = (commit: boolean) => () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (commit && to !== from) onMove(from, to);
    };
    const done = finish(true);
    const cancel = finish(false);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", cancel);
  };

  return { drag, begin };
}

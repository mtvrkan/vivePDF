import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export type DropSide = "before" | "after";
export type DragAxis = "x" | "y";
export type DropProbe = { key: string; side: DropSide };

const DRAG_THRESHOLD = 4;
const EDGE_SCROLL = 28;
const EDGE_STEP = 12;

export function dropSide(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, x: number, y: number, axis: DragAxis, rtl = false): DropSide {
  if (axis === "y") return y < rect.top + rect.height / 2 ? "before" : "after";
  const before = x < rect.left + rect.width / 2;
  return before !== rtl ? "before" : "after";
}

export function moveIndex(from: number, target: number, side: DropSide): number | null {
  const slot = target + (side === "after" ? 1 : 0);
  const index = slot > from ? slot - 1 : slot;
  return index === from ? null : index;
}

export function probeAt(x: number, y: number, attribute: string, axis: DragAxis, scope: Element | null): DropProbe | null {
  const node = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${attribute}]`);
  if (!node || (scope && !scope.contains(node))) return null;
  const key = node.getAttribute(attribute);
  if (!key) return null;
  return { key, side: dropSide(node.getBoundingClientRect(), x, y, axis, getComputedStyle(node).direction === "rtl") };
}

function scrollNear(container: HTMLElement | null, x: number, y: number, axis: DragAxis) {
  if (!container) return;
  const box = container.getBoundingClientRect();
  if (axis === "y") {
    if (y < box.top + EDGE_SCROLL) container.scrollTop -= EDGE_STEP;
    else if (y > box.bottom - EDGE_SCROLL) container.scrollTop += EDGE_STEP;
  } else if (x < box.left + EDGE_SCROLL) container.scrollLeft -= EDGE_STEP;
  else if (x > box.right - EDGE_SCROLL) container.scrollLeft += EDGE_STEP;
}

type Pending<S> = { source: S; x: number; y: number; pointerId: number; node: HTMLElement; active: boolean };

export type DragSortOptions<S, T> = {
  attribute: string;
  axis: DragAxis;
  container: React.RefObject<HTMLElement | null>;
  resolve: (source: S, probe: DropProbe) => T | null;
  drop: (source: S, target: T) => void;
};

export function useDragSort<S, T>({ attribute, axis, container, resolve, drop }: DragSortOptions<S, T>) {
  const [drag, setDrag] = useState<{ source: S; target: T | null } | null>(null);
  const pending = useRef<Pending<S> | null>(null);
  const target = useRef<T | null>(null);
  const swallowClick = useRef(false);
  const latest = useRef({ resolve, drop });
  latest.current = { resolve, drop };

  const cancel = () => {
    const current = pending.current;
    if (current?.active && current.node.hasPointerCapture(current.pointerId)) current.node.releasePointerCapture(current.pointerId);
    pending.current = null;
    target.current = null;
    setDrag(null);
  };

  useEffect(() => {
    if (!drag) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      swallowClick.current = true;
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag]);

  const bind = (source: S) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      swallowClick.current = false;
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      pending.current = { source, x: event.clientX, y: event.clientY, pointerId: event.pointerId, node: event.currentTarget, active: false };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const current = pending.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.active) {
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
        current.active = true;
        current.node.setPointerCapture(event.pointerId);
      }
      scrollNear(container.current, event.clientX, event.clientY, axis);
      const probe = probeAt(event.clientX, event.clientY, attribute, axis, container.current);
      if (probe) target.current = latest.current.resolve(current.source, probe);
      setDrag({ source: current.source, target: target.current });
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const current = pending.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const chosen = target.current;
      if (current.active) {
        swallowClick.current = true;
        if (chosen !== null) latest.current.drop(current.source, chosen);
      }
      cancel();
    },
    onPointerCancel: cancel,
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return { drag, bind };
}

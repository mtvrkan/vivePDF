import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export const TEAR_OFF_DISTANCE = 8;

export function isOutsideViewport(x: number, y: number, width: number, height: number): boolean {
  return x < 0 || y < 0 || x >= width || y >= height;
}

export const REORDER_SLACK = 24;

export function dropIndexAt(clientX: number, centers: number[]): number {
  return centers.filter((center) => center < clientX).length;
}

export function isOverStrip(y: number, strip: { top: number; bottom: number }): boolean {
  return y >= strip.top - REORDER_SLACK && y <= strip.bottom + REORDER_SLACK;
}

type Reorder = { strip: () => HTMLElement | null; onReorder: (id: string, toIndex: number) => void };
type DropMark = { index: number; x: number };

function otherTabs(strip: HTMLElement, tab: HTMLElement): HTMLElement[] {
  return Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]')).filter((entry) => entry !== tab);
}

function dropMark(strip: HTMLElement, tab: HTMLElement, clientX: number): DropMark {
  const others = otherTabs(strip, tab).map((entry) => entry.getBoundingClientRect());
  const index = dropIndexAt(clientX, others.map((rect) => rect.left + rect.width / 2));
  const origin = strip.getBoundingClientRect().left;
  const edge = index < others.length ? others[index].left : (others[others.length - 1]?.right ?? origin);
  return { index, x: edge - origin };
}

export function useTabTearOff(onTearOff: (id: string) => void, reorder?: Reorder) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);
  const draggedRef = useRef(false);
  const tearOffRef = useRef(onTearOff);
  tearOffRef.current = onTearOff;
  const reorderRef = useRef(reorder);
  reorderRef.current = reorder;

  const onPointerDown = useCallback((id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const tab = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let finished = false;
    draggedRef.current = false;
    try {
      tab.setPointerCapture(pointerId);
    } catch {
      return;
    }
    const markAt = (event: PointerEvent): DropMark | null => {
      const strip = reorderRef.current?.strip();
      if (!strip || !isOverStrip(event.clientY, strip.getBoundingClientRect())) return null;
      return dropMark(strip, tab, event.clientX);
    };
    const onMove = (move: PointerEvent) => {
      if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) < TEAR_OFF_DISTANCE) return;
      if (!moved) {
        moved = true;
        setDraggingId(id);
      }
      setMark(markAt(move));
    };
    const finish = (end: PointerEvent, cancelled: boolean) => {
      if (finished) return;
      finished = true;
      tab.removeEventListener("pointermove", onMove);
      tab.removeEventListener("pointerup", onUp);
      tab.removeEventListener("pointercancel", onCancel);
      tab.removeEventListener("lostpointercapture", onCancel);
      if (tab.hasPointerCapture(pointerId)) tab.releasePointerCapture(pointerId);
      setDraggingId(null);
      setMark(null);
      if (!moved) return;
      draggedRef.current = true;
      if (cancelled) return;
      if (isOutsideViewport(end.clientX, end.clientY, window.innerWidth, window.innerHeight)) {
        tearOffRef.current(id);
        return;
      }
      const dropped = markAt(end);
      if (dropped) reorderRef.current?.onReorder(id, dropped.index);
    };
    const onUp = (end: PointerEvent) => finish(end, false);
    const onCancel = (end: PointerEvent) => finish(end, true);
    tab.addEventListener("pointermove", onMove);
    tab.addEventListener("pointerup", onUp);
    tab.addEventListener("pointercancel", onCancel);
    tab.addEventListener("lostpointercapture", onCancel);
  }, []);

  const consumeDrag = useCallback(() => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  return { draggingId, dropMark: mark, onPointerDown, consumeDrag };
}

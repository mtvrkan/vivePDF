import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export const TEAR_OFF_DISTANCE = 8;

export function isOutsideViewport(x: number, y: number, width: number, height: number): boolean {
  return x < 0 || y < 0 || x >= width || y >= height;
}

export function useTabTearOff(onTearOff: (id: string) => void) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggedRef = useRef(false);
  const tearOffRef = useRef(onTearOff);
  tearOffRef.current = onTearOff;

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
    const onMove = (move: PointerEvent) => {
      if (moved || Math.hypot(move.clientX - startX, move.clientY - startY) < TEAR_OFF_DISTANCE) return;
      moved = true;
      setDraggingId(id);
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
      if (!moved) return;
      draggedRef.current = true;
      if (!cancelled && isOutsideViewport(end.clientX, end.clientY, window.innerWidth, window.innerHeight)) tearOffRef.current(id);
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

  return { draggingId, onPointerDown, consumeDrag };
}

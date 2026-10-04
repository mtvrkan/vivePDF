import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

const DRAG_THRESHOLD = 6;
const EDGE_ZONE = 48;
const SCROLL_STEP = 14;

type DragState = { key: string; count: number; x: number; y: number };

export function passedDragThreshold(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD;
}

type UseTileDragOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  dropIndexAt: (clientX: number, clientY: number) => number;
  selectedKeys: Set<string>;
  onMove: (keys: Set<string>, dropIndex: number) => void;
};

export function useTileDrag({ scrollRef, dropIndexAt, selectedKeys, onMove }: UseTileDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const pendingRef = useRef<{ key: string; startX: number; startY: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dropRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const moveFrameRef = useRef<number | null>(null);

  const stopAutoScroll = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const autoScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !dragRef.current) {
      stopAutoScroll();
      return;
    }
    const rect = container.getBoundingClientRect();
    const { y } = pointerRef.current;
    if (y < rect.top + EDGE_ZONE) container.scrollTop -= SCROLL_STEP;
    else if (y > rect.bottom - EDGE_ZONE) container.scrollTop += SCROLL_STEP;
    rafRef.current = requestAnimationFrame(autoScroll);
  }, [scrollRef]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const pending = pendingRef.current;
      if (pending && !dragRef.current) {
        if (!passedDragThreshold(pending.startX, pending.startY, event.clientX, event.clientY)) return;
        const count = selectedKeys.has(pending.key) ? selectedKeys.size : 1;
        dragRef.current = { key: pending.key, count, x: event.clientX, y: event.clientY };
        setDrag(dragRef.current);
        suppressClickRef.current = true;
        rafRef.current = requestAnimationFrame(autoScroll);
      }
      if (dragRef.current) {
        dragRef.current = { ...dragRef.current, x: event.clientX, y: event.clientY };
        if (moveFrameRef.current === null) moveFrameRef.current = requestAnimationFrame(flushMove);
      }
    };
    const flushMove = () => {
      moveFrameRef.current = null;
      const active = dragRef.current;
      if (!active) return;
      setDrag(active);
      const index = dropIndexAt(active.x, active.y);
      if (dropRef.current !== index) {
        dropRef.current = index;
        setDropIndex(index);
      }
    };
    const cancelMoveFrame = () => {
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    };
    const finish = (commit: boolean) => {
      if (moveFrameRef.current !== null && dragRef.current) {
        cancelMoveFrame();
        dropRef.current = dropIndexAt(dragRef.current.x, dragRef.current.y);
      }
      const active = dragRef.current;
      const target = dropRef.current;
      pendingRef.current = null;
      dragRef.current = null;
      dropRef.current = null;
      stopAutoScroll();
      setDrag(null);
      setDropIndex(null);
      if (commit && active && target !== null) {
        const keys = selectedKeys.has(active.key) ? new Set(selectedKeys) : new Set([active.key]);
        onMove(keys, target);
      }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    const onPointerUp = () => finish(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) finish(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      cancelMoveFrame();
      stopAutoScroll();
    };
  }, [selectedKeys, onMove, dropIndexAt, autoScroll]);

  const onTilePointerDown = useCallback((event: ReactPointerEvent, key: string) => {
    if (event.button !== 0) return;
    pendingRef.current = { key, startX: event.clientX, startY: event.clientY };
  }, []);

  const wasDragged = useCallback(() => suppressClickRef.current, []);

  return { drag, dropIndex, onTilePointerDown, wasDragged };
}

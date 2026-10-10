import { useCallback, useRef, useState, type RefObject } from "react";

export function useDragState<T>(): [T | null, (next: T | null) => void, RefObject<T | null>] {
  const [drag, setDragState] = useState<T | null>(null);
  const latest = useRef<T | null>(null);
  const setDrag = useCallback((next: T | null) => {
    latest.current = next;
    setDragState(next);
  }, []);
  return [drag, setDrag, latest];
}

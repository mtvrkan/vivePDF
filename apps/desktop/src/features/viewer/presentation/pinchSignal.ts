import { useEffect, useRef, type RefObject } from "react";

type TouchLike = { touches?: { length: number } };
type PointerLike = { pointerId?: number; pointerType?: string };

const PINCH_FINGERS = 2;

export function watchPinch(target: EventTarget, onPinch: () => void): () => void {
  const touchPointers = new Set<number>();
  const onTouch = (event: Event) => {
    if (((event as TouchLike).touches?.length ?? 0) >= PINCH_FINGERS) onPinch();
  };
  const onGesture = () => onPinch();
  const onPointerDown = (event: Event) => {
    const pointer = event as PointerLike;
    if (pointer.pointerType !== "touch" || pointer.pointerId === undefined) return;
    touchPointers.add(pointer.pointerId);
    if (touchPointers.size >= PINCH_FINGERS) onPinch();
  };
  const onPointerEnd = (event: Event) => {
    const pointer = event as PointerLike;
    if (pointer.pointerId !== undefined) touchPointers.delete(pointer.pointerId);
  };
  const listeners: Array<[string, (event: Event) => void]> = [
    ["touchstart", onTouch],
    ["touchmove", onTouch],
    ["gesturestart", onGesture],
    ["gesturechange", onGesture],
    ["pointerdown", onPointerDown],
    ["pointerup", onPointerEnd],
    ["pointercancel", onPointerEnd],
  ];
  for (const [type, listener] of listeners) target.addEventListener(type, listener, { capture: true, passive: true });
  return () => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, { capture: true });
  };
}

export function usePinchSignal(ref: RefObject<HTMLElement | null>, onPinch: () => void) {
  const callback = useRef(onPinch);
  callback.current = onPinch;
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    return watchPinch(target, () => callback.current());
  }, [ref]);
}

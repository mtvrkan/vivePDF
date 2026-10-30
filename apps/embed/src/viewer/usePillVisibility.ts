import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";
import { createScrollHider } from "./scrollHider";

const HIDE_AFTER_PX = 24;
const TAP_SLOP_PX = 8;

export function usePillVisibility(host: HTMLElement | null, pillRef: RefObject<HTMLElement>, keepVisible: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!host || !window.matchMedia("(pointer: coarse)").matches) return;
    const hider = createScrollHider(HIDE_AFTER_PX);
    let start: { x: number; y: number } | null = null;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.scrollHeight > target.clientHeight) setHidden(hider(target.scrollTop));
    };
    const onPointerDown = (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < TAP_SLOP_PX) setHidden(false);
      start = null;
    };
    const onFocusIn = (event: FocusEvent) => {
      if (pillRef.current && event.composedPath().includes(pillRef.current)) setHidden(false);
    };
    host.addEventListener("scroll", onScroll, { capture: true, passive: true });
    host.addEventListener("pointerdown", onPointerDown, { passive: true });
    host.addEventListener("pointerup", onPointerUp, { passive: true });
    host.addEventListener("focusin", onFocusIn);
    return () => {
      host.removeEventListener("scroll", onScroll, { capture: true });
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("focusin", onFocusIn);
    };
  }, [host, pillRef]);

  return hidden && !keepVisible;
}

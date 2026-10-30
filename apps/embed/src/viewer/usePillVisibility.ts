import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";
import { createScrollHider } from "./scrollHider";

const HIDE_AFTER_PX = 24;
const TAP_SLOP_PX = 8;
const MOMENTUM_MS = 1200;

export function usePillVisibility(host: HTMLElement | null, pillRef: RefObject<HTMLElement>, keepVisible: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!host || !window.matchMedia("(pointer: coarse)").matches) return;
    const hider = createScrollHider(HIDE_AFTER_PX);
    let start: { x: number; y: number } | null = null;
    let releasedAt = -Infinity;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains("vp-viewport")) return;
      const userDriven = start !== null || performance.now() - releasedAt < MOMENTUM_MS;
      setHidden(hider(target.scrollTop, userDriven));
    };
    const onPointerDown = (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      const tapped = start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) < TAP_SLOP_PX;
      if (tapped) setHidden(false);
      else if (start) releasedAt = performance.now();
      start = null;
    };
    const onPointerCancel = () => {
      if (start) releasedAt = performance.now();
      start = null;
    };
    const onFocusIn = (event: FocusEvent) => {
      if (pillRef.current && event.composedPath().includes(pillRef.current)) setHidden(false);
    };
    host.addEventListener("scroll", onScroll, { capture: true, passive: true });
    host.addEventListener("pointerdown", onPointerDown, { passive: true });
    host.addEventListener("pointerup", onPointerUp, { passive: true });
    host.addEventListener("pointercancel", onPointerCancel, { passive: true });
    host.addEventListener("focusin", onFocusIn);
    return () => {
      host.removeEventListener("scroll", onScroll, { capture: true });
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerCancel);
      host.removeEventListener("focusin", onFocusIn);
    };
  }, [host, pillRef]);

  return hidden && !keepVisible;
}

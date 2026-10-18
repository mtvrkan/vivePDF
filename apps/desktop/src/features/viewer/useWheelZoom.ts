import { useEffect, useRef, type RefObject } from "react";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { ZOOM_MAX_LEVEL, ZOOM_MIN_LEVEL, wheelZoomFactor } from "./zoomShortcuts";

const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;
export const PINCH_HOLD_MS = 400;

const zoomsPage = (event: WheelEvent | KeyboardEvent) => event.ctrlKey || event.metaKey;

export function useWheelZoom(hostRef: RefObject<HTMLDivElement | null>, documentId: string) {
  const { provides: zoom } = useZoom(documentId);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let pendingDelta = 0;
    let center = { vx: 0, vy: 0 };
    let frame = 0;
    let modifierHeld = false;
    let pinchTimer: ReturnType<typeof setTimeout> | null = null;
    let blocking = false;

    const flush = () => {
      frame = 0;
      const scope = zoomRef.current;
      const delta = pendingDelta;
      pendingDelta = 0;
      if (!scope || delta === 0) return;
      const current = scope.getState().currentZoomLevel;
      const target = Math.min(ZOOM_MAX_LEVEL, Math.max(ZOOM_MIN_LEVEL, current * wheelZoomFactor(delta)));
      if (Math.abs(target - current) < 0.001) return;
      scope.requestZoom(Number(target.toFixed(3)), center);
    };

    const blockPageZoom = (event: WheelEvent) => {
      if (zoomsPage(event)) event.preventDefault();
    };
    const refreshBlocking = () => {
      const wanted = modifierHeld || pinchTimer !== null;
      if (wanted === blocking) return;
      blocking = wanted;
      if (wanted) host.addEventListener("wheel", blockPageZoom, { passive: false, capture: true });
      else host.removeEventListener("wheel", blockPageZoom, { capture: true });
    };

    const onWheel = (event: WheelEvent) => {
      if (!zoomsPage(event)) return;
      event.stopPropagation();
      if (pinchTimer !== null) clearTimeout(pinchTimer);
      pinchTimer = setTimeout(() => {
        pinchTimer = null;
        refreshBlocking();
      }, PINCH_HOLD_MS);
      refreshBlocking();
      const scroller = host.querySelector<HTMLElement>("[data-pan-scroller]");
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      center = { vx: event.clientX - rect.left, vy: event.clientY - rect.top };
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT_PX : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? PAGE_HEIGHT_PX : 1;
      pendingDelta += event.deltaY * unit;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onKey = (event: KeyboardEvent) => {
      modifierHeld = zoomsPage(event);
      refreshBlocking();
    };
    const onBlur = () => {
      modifierHeld = false;
      refreshBlocking();
    };

    host.addEventListener("wheel", onWheel, { passive: true, capture: true });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      host.removeEventListener("wheel", onWheel, { capture: true });
      host.removeEventListener("wheel", blockPageZoom, { capture: true });
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      if (pinchTimer !== null) clearTimeout(pinchTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [hostRef]);
}

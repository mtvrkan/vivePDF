import { useEffect, useRef, useState } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { areaBetween, marksInArea, useAreaSelectStore } from "./markArea";

const CLICK_LIMIT_PX = 4;
const PAGE_EVENTS = ["mousedown", "mousemove", "mouseup", "click", "dblclick"] as const;

type Point = { x: number; y: number };
type Drag = { start: Point; end: Point; additive: boolean };

export function AreaSelectLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const active = useAreaSelectStore((state) => state.documentId === documentId);
  const { provides: annotation } = useAnnotation(documentId);
  const { state: zoomState } = useZoom(documentId);
  const [drag, setDrag] = useState<Drag | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<(current: Drag) => void>(() => undefined);

  finishRef.current = (current) => {
    if (!annotation) return;
    const moved = Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y);
    const previous = current.additive ? annotation.getSelectedAnnotationIds() : [];
    if (moved <= CLICK_LIMIT_PX) {
      if (!current.additive) annotation.deselectAnnotation();
      return;
    }
    const state = annotation.getState();
    const objects = (state.pages[pageIndex] ?? []).flatMap((uid) => (state.byUid[uid] ? [state.byUid[uid].object] : []));
    const picked = marksInArea(objects, areaBetween(current.start, current.end, zoomState.currentZoomLevel)).map((object) => object.id);
    const ids = [...new Set([...previous, ...picked])];
    if (ids.length === 0) annotation.deselectAnnotation();
    else annotation.setSelection(ids);
  };

  useEffect(() => {
    const layer = layerRef.current;
    if (!active || !layer) return;
    let current: Drag | null = null;
    const pointOf = (event: PointerEvent): Point => ({ x: event.offsetX, y: event.offsetY });
    const onPointerDown = (event: PointerEvent) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      event.preventDefault();
      layer.setPointerCapture(event.pointerId);
      const point = pointOf(event);
      current = { start: point, end: point, additive: event.shiftKey || event.ctrlKey || event.metaKey };
      setDrag(current);
    };
    const onPointerMove = (event: PointerEvent) => {
      event.stopPropagation();
      if (!current) return;
      current = { ...current, end: pointOf(event) };
      setDrag(current);
    };
    const onPointerUp = (event: PointerEvent) => {
      event.stopPropagation();
      if (!current) return;
      finishRef.current({ ...current, end: pointOf(event) });
      current = null;
      setDrag(null);
    };
    const onPointerCancel = (event: PointerEvent) => {
      event.stopPropagation();
      current = null;
      setDrag(null);
    };
    const keepFromPage = (event: Event) => event.stopPropagation();
    layer.addEventListener("pointerdown", onPointerDown);
    layer.addEventListener("pointermove", onPointerMove);
    layer.addEventListener("pointerup", onPointerUp);
    layer.addEventListener("pointercancel", onPointerCancel);
    for (const type of PAGE_EVENTS) layer.addEventListener(type, keepFromPage);
    return () => {
      layer.removeEventListener("pointerdown", onPointerDown);
      layer.removeEventListener("pointermove", onPointerMove);
      layer.removeEventListener("pointerup", onPointerUp);
      layer.removeEventListener("pointercancel", onPointerCancel);
      for (const type of PAGE_EVENTS) layer.removeEventListener(type, keepFromPage);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div ref={layerRef} data-area-select className="absolute inset-0 z-50 cursor-crosshair touch-none select-none">
      {drag ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-sm border border-primary bg-primary/15"
          style={{
            left: Math.min(drag.start.x, drag.end.x),
            top: Math.min(drag.start.y, drag.end.y),
            width: Math.abs(drag.end.x - drag.start.x),
            height: Math.abs(drag.end.y - drag.start.y),
          }}
        />
      ) : null}
    </div>
  );
}

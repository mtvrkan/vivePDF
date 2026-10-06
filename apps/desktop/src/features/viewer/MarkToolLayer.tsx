import { useEffect, useRef, useState } from "react";
import { PdfAnnotationSubtype, type PdfInkAnnoObject } from "@embedpdf/models";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { eraseAlong, inkBounds, sameStrokes } from "./inkErase";
import { areaBetween, marksInArea, useMarkToolMode, useMarkToolStore, type MarkToolMode } from "./markArea";

const CLICK_LIMIT_PX = 4;
const PAGE_EVENTS = ["mousedown", "mousemove", "mouseup", "click", "dblclick"] as const;

type Point = { x: number; y: number };
type Gesture = { mode: MarkToolMode; path: Point[]; additive: boolean };

export function MarkToolLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const mode = useMarkToolMode(documentId);
  const eraserSize = useMarkToolStore((state) => state.eraserSize);
  const { provides: annotation } = useAnnotation(documentId);
  const { state: zoomState } = useZoom(documentId);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<(current: Gesture) => void>(() => undefined);
  const scale = zoomState.currentZoomLevel;

  finishRef.current = (current) => {
    if (!annotation) return;
    const state = annotation.getState();
    const objects = (state.pages[pageIndex] ?? []).flatMap((uid) => (state.byUid[uid] ? [state.byUid[uid].object] : []));
    if (current.mode === "erase") {
      const path = current.path.map((point) => ({ x: point.x / scale, y: point.y / scale }));
      const radius = eraserSize / scale;
      for (const object of objects) {
        if (object.type !== PdfAnnotationSubtype.INK) continue;
        const ink = object as PdfInkAnnoObject;
        const strokes = eraseAlong(ink.inkList, path, radius);
        if (sameStrokes(strokes, ink.inkList)) continue;
        const rect = inkBounds(strokes, ink.strokeWidth);
        if (!rect) annotation.deleteAnnotation(pageIndex, ink.id);
        else annotation.updateAnnotation(pageIndex, ink.id, { inkList: strokes, rect, author: ink.author });
      }
      return;
    }
    const start = current.path[0];
    const end = current.path[current.path.length - 1];
    const previous = current.additive ? annotation.getSelectedAnnotationIds() : [];
    if (Math.hypot(end.x - start.x, end.y - start.y) <= CLICK_LIMIT_PX) {
      if (!current.additive) annotation.deselectAnnotation();
      return;
    }
    const picked = marksInArea(objects, areaBetween(start, end, scale)).map((object) => object.id);
    const ids = [...new Set([...previous, ...picked])];
    if (ids.length === 0) annotation.deselectAnnotation();
    else annotation.setSelection(ids);
  };

  useEffect(() => {
    const layer = layerRef.current;
    if (!mode || !layer) return;
    let current: Gesture | null = null;
    const pointOf = (event: PointerEvent): Point => ({ x: event.offsetX, y: event.offsetY });
    const onPointerDown = (event: PointerEvent) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      event.preventDefault();
      layer.setPointerCapture(event.pointerId);
      current = { mode, path: [pointOf(event)], additive: event.shiftKey || event.ctrlKey || event.metaKey };
      setGesture(current);
    };
    const onPointerMove = (event: PointerEvent) => {
      event.stopPropagation();
      const point = pointOf(event);
      setHover(point);
      if (!current) return;
      current = { ...current, path: current.mode === "erase" ? [...current.path, point] : [current.path[0], point] };
      setGesture(current);
    };
    const onPointerUp = (event: PointerEvent) => {
      event.stopPropagation();
      if (!current) return;
      const point = pointOf(event);
      finishRef.current({ ...current, path: current.mode === "erase" ? [...current.path, point] : [current.path[0], point] });
      current = null;
      setGesture(null);
    };
    const onPointerCancel = (event: PointerEvent) => {
      event.stopPropagation();
      current = null;
      setGesture(null);
    };
    const onPointerLeave = () => setHover(null);
    const keepFromPage = (event: Event) => event.stopPropagation();
    layer.addEventListener("pointerdown", onPointerDown);
    layer.addEventListener("pointermove", onPointerMove);
    layer.addEventListener("pointerup", onPointerUp);
    layer.addEventListener("pointercancel", onPointerCancel);
    layer.addEventListener("pointerleave", onPointerLeave);
    for (const type of PAGE_EVENTS) layer.addEventListener(type, keepFromPage);
    return () => {
      layer.removeEventListener("pointerdown", onPointerDown);
      layer.removeEventListener("pointermove", onPointerMove);
      layer.removeEventListener("pointerup", onPointerUp);
      layer.removeEventListener("pointercancel", onPointerCancel);
      layer.removeEventListener("pointerleave", onPointerLeave);
      for (const type of PAGE_EVENTS) layer.removeEventListener(type, keepFromPage);
    };
  }, [mode]);

  if (!mode) return null;

  const box = gesture?.mode === "area" ? { start: gesture.path[0], end: gesture.path[gesture.path.length - 1] } : null;
  const trail = gesture?.mode === "erase" ? gesture.path : null;

  return (
    <div ref={layerRef} data-mark-tool={mode} className={mode === "erase" ? "absolute inset-0 z-50 cursor-none touch-none select-none" : "absolute inset-0 z-50 cursor-crosshair touch-none select-none"}>
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-sm border border-primary bg-primary/15"
          style={{ left: Math.min(box.start.x, box.end.x), top: Math.min(box.start.y, box.end.y), width: Math.abs(box.end.x - box.start.x), height: Math.abs(box.end.y - box.start.y) }}
        />
      ) : null}
      {mode === "erase" ? (
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
          {trail ? (
            <polyline points={trail.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" strokeWidth={eraserSize * 2} strokeLinecap="round" strokeLinejoin="round" className="stroke-foreground/15" />
          ) : null}
          {hover ? <circle cx={hover.x} cy={hover.y} r={eraserSize} className="fill-background/40 stroke-foreground/70" strokeWidth={1} /> : null}
        </svg>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import { LiveStrokeCanvas, PageDrawingCanvas } from "./DrawingLayer";
import { LaserTrail, type LaserPoint } from "./LaserTrail";
import { eraserCursor, highlighterCursor, penCursor } from "./toolCursor";
import { MagnifierLens } from "./MagnifierLens";
import { clampStrokePoint } from "./strokes";
import { nearestPageRect, pageRectAt, usePageRects, type PageRect } from "./usePageRects";

const SPOTLIGHT_WHEEL_SENSITIVITY = 0.4;
const MAGNIFIER_WHEEL_SENSITIVITY = 0.004;
const SPOTLIGHT_RECT_RATIO = 0.42;
const MIDDLE_BUTTON = 1;
const LASER_TRAIL_LENGTH = 6;
const LASER_STROKE_MAX_POINTS = 600;
const LASER_STROKE_MIN_STEP_PX = 2;
const LASER_FADE_MS = 700;

const ERASER_RADIUS = 0.02;
const DRAWING_TOOLS = new Set(["pen", "highlighter", "eraser"]);

function pagePoint(rect: PageRect, x: number, y: number) {
  return clampStrokePoint({ x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height });
}

function makeStrokeId(): string {
  return `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PresentationCanvas({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const tool = usePresentationStore((state) => state.tool);
  const penColor = usePresentationStore((state) => state.penColor);
  const penWidth = usePresentationStore((state) => state.penWidth);
  const laserColor = usePresentationStore((state) => state.laserColor);
  const laserSize = usePresentationStore((state) => state.laserSize);
  const spotlightRadius = usePresentationStore((state) => state.spotlightRadius);
  const spotlightShape = usePresentationStore((state) => state.spotlightShape);
  const spotlightDim = usePresentationStore((state) => state.spotlightDim);
  const addStroke = usePresentationStore((state) => state.addStroke);
  const eraseAt = usePresentationStore((state) => state.eraseAt);
  const nudgeSpotlightRadius = usePresentationStore((state) => state.nudgeSpotlightRadius);
  const nudgeMagnifierZoom = usePresentationStore((state) => state.nudgeMagnifierZoom);

  const pageRects = usePageRects(containerRef);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [laserTrail, setLaserTrail] = useState<Array<{ x: number; y: number }>>([]);
  const [activeStroke, setActiveStroke] = useState<{ pageIndex: number; stroke: Stroke } | null>(null);
  const [laserStroke, setLaserStroke] = useState<LaserPoint[] | null>(null);
  const [fadingLasers, setFadingLasers] = useState<Array<{ id: string; points: LaserPoint[] }>>([]);
  const drawingRef = useRef<{ pageIndex: number; stroke: Stroke } | null>(null);
  const erasingRef = useRef(false);
  const laserDrawingRef = useRef(false);
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const fadeTimers = useRef<Set<number>>(new Set());

  const captureActive = tool !== "pointer";

  const toContainerPoint = (event: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return { x: event.clientX, y: event.clientY };
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const releaseLaserStroke = () => {
    laserDrawingRef.current = false;
    setLaserStroke((points) => {
      if (points && points.length > 1) {
        const id = makeStrokeId();
        setFadingLasers((strokes) => [...strokes, { id, points }]);
        const timer = window.setTimeout(() => {
          fadeTimers.current.delete(timer);
          setFadingLasers((strokes) => strokes.filter((entry) => entry.id !== id));
        }, LASER_FADE_MS);
        fadeTimers.current.add(timer);
      }
      return null;
    });
  };

  const eraseEverywhere = (x: number, y: number) => {
    for (const rect of pageRects) eraseAt(rect.pageIndex, pagePoint(rect, x, y), ERASER_RADIUS);
  };

  const scrollerElement = () => containerRef.current?.querySelector<HTMLElement>("[data-pan-scroller]") ?? null;

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button === MIDDLE_BUTTON) {
      const scroller = scrollerElement();
      if (!scroller) return;
      event.preventDefault();
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (tool === "laser") {
      laserDrawingRef.current = true;
      setLaserStroke([{ x: event.clientX, y: event.clientY }]);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!DRAWING_TOOLS.has(tool)) return;
    const point = toContainerPoint(event);
    const pageRect = nearestPageRect(pageRects, point.x, point.y);
    if (!pageRect) return;
    const normalized = pagePoint(pageRect, point.x, point.y);
    if (tool === "eraser") {
      erasingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      eraseEverywhere(point.x, point.y);
      return;
    }
    const stroke: Stroke = {
      id: makeStrokeId(),
      tool: tool === "highlighter" ? "highlighter" : "pen",
      color: penColor,
      width: tool === "highlighter" ? penWidth * 3 * 0.01 : penWidth * 0.01,
      points: [normalized],
    };
    drawingRef.current = { pageIndex: pageRect.pageIndex, stroke };
    setActiveStroke({ pageIndex: pageRect.pageIndex, stroke });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const pan = panRef.current;
    if (pan) {
      if (event.pointerId !== pan.pointerId) return;
      const scroller = scrollerElement();
      if (!scroller) return;
      scroller.scrollLeft = pan.left - (event.clientX - pan.x);
      scroller.scrollTop = pan.top - (event.clientY - pan.y);
      return;
    }
    if (tool === "laser") {
      const next = { x: event.clientX, y: event.clientY };
      setPointer(next);
      setLaserTrail((trail) => [...trail, next].slice(-LASER_TRAIL_LENGTH));
      if (laserDrawingRef.current) {
        setLaserStroke((points) => {
          if (!points) return [next];
          const last = points[points.length - 1];
          if (Math.hypot(next.x - last.x, next.y - last.y) < LASER_STROKE_MIN_STEP_PX) return points;
          return [...points, next].slice(-LASER_STROKE_MAX_POINTS);
        });
      }
      return;
    }
    if (tool === "spotlight" || tool === "magnifier") {
      setPointer({ x: event.clientX, y: event.clientY });
      return;
    }
    if (!DRAWING_TOOLS.has(tool)) return;
    const point = toContainerPoint(event);
    if (tool === "eraser") {
      if (!erasingRef.current) return;
      eraseEverywhere(point.x, point.y);
      return;
    }
    const current = drawingRef.current;
    if (!current) return;
    const pageRect = pageRects.find((rect) => rect.pageIndex === current.pageIndex);
    if (!pageRect) return;
    const normalized = pagePoint(pageRect, point.x, point.y);
    const nextStroke: Stroke = { ...current.stroke, points: [...current.stroke.points, normalized] };
    drawingRef.current = { pageIndex: current.pageIndex, stroke: nextStroke };
    setActiveStroke({ pageIndex: current.pageIndex, stroke: nextStroke });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (panRef.current) {
      if (event.pointerId !== panRef.current.pointerId) return;
      panRef.current = null;
      return;
    }
    if (tool === "laser") {
      releaseLaserStroke();
      return;
    }
    if (tool === "eraser") {
      erasingRef.current = false;
      return;
    }
    const current = drawingRef.current;
    if (current && current.stroke.points.length > 1) addStroke(current.pageIndex, current.stroke);
    drawingRef.current = null;
    setActiveStroke(null);
  };

  useEffect(() => {
    if (tool === "laser") return;
    laserDrawingRef.current = false;
    setLaserStroke(null);
    setFadingLasers([]);
  }, [tool]);

  useEffect(() => {
    const timers = fadeTimers.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const onWheel = (event: React.WheelEvent) => {
    if (tool === "spotlight") {
      event.preventDefault();
      nudgeSpotlightRadius(-event.deltaY * SPOTLIGHT_WHEEL_SENSITIVITY);
      return;
    }
    if (tool === "magnifier") {
      event.preventDefault();
      nudgeMagnifierZoom(-event.deltaY * MAGNIFIER_WHEEL_SENSITIVITY);
      return;
    }
    if (event.nativeEvent.defaultPrevented) return;
    const scroller = containerRef.current?.querySelector<HTMLElement>("[data-pan-scroller]");
    if (!scroller) return;
    if (event.ctrlKey || event.metaKey) {
      const { deltaX, deltaY, deltaZ, deltaMode, clientX, clientY, ctrlKey, metaKey, shiftKey, altKey } = event;
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, deltaZ, deltaMode, clientX, clientY, ctrlKey, metaKey, shiftKey, altKey, bubbles: true, cancelable: true }));
      return;
    }
    scroller.scrollBy({ top: event.deltaY, left: event.deltaX });
  };

  const overlayCursor =
    tool === "laser" || tool === "spotlight" || tool === "magnifier"
      ? "none"
      : tool === "pen"
        ? penCursor(penColor)
        : tool === "highlighter"
          ? highlighterCursor(penColor)
          : tool === "eraser"
            ? eraserCursor("#1f2937")
            : "crosshair";

  const magnifierPageRect = pointer ? (() => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return pageRectAt(pageRects, pointer.x - rect.left, pointer.y - rect.top);
  })() : null;

  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pageRects.map((rect) => (
          <PageDrawingCanvas key={rect.pageIndex} rect={rect} />
        ))}
        {activeStroke
          ? (() => {
              const rect = pageRects.find((entry) => entry.pageIndex === activeStroke.pageIndex);
              return rect ? <LiveStrokeCanvas rect={rect} stroke={activeStroke.stroke} /> : null;
            })()
          : null}
      </div>
      {captureActive ? (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            setPointer(null);
            setLaserTrail([]);
            if (laserDrawingRef.current) releaseLaserStroke();
          }}
          onWheel={onWheel}
          className="absolute inset-0 z-20"
          style={{ cursor: overlayCursor, touchAction: "none" }}
        />
      ) : null}
      {laserStroke ? <LaserTrail points={laserStroke} color={laserColor} size={laserSize} /> : null}
      {fadingLasers.map((entry) => (
        <LaserTrail key={entry.id} points={entry.points} color={laserColor} size={laserSize} fading />
      ))}
      {tool === "laser" && pointer
        ? laserTrail.map((point, index) => (
            <span
              key={index}
              aria-hidden
              className="laser-dot pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: point.x,
                top: point.y,
                width: laserSize * (index === laserTrail.length - 1 ? 1 : 0.5),
                height: laserSize * (index === laserTrail.length - 1 ? 1 : 0.5),
                opacity: (index + 1) / laserTrail.length,
                background: `radial-gradient(circle, ${laserColor} 0%, transparent 70%)`,
                boxShadow: `0 0 ${laserSize}px ${laserSize / 2}px ${laserColor}88`,
              }}
            />
          ))
        : null}
      {tool === "spotlight" && pointer ? (
        <div
          aria-hidden
          className={cn("pointer-events-none fixed z-30", spotlightShape === "circle" ? "rounded-full" : "rounded-xl")}
          style={{
            left: pointer.x - spotlightRadius,
            top: pointer.y - (spotlightShape === "circle" ? spotlightRadius : spotlightRadius * SPOTLIGHT_RECT_RATIO),
            width: spotlightRadius * 2,
            height: spotlightShape === "circle" ? spotlightRadius * 2 : spotlightRadius * SPOTLIGHT_RECT_RATIO * 2,
            boxShadow: `0 0 0 9999px rgba(0,0,0,${spotlightDim})`,
          }}
        />
      ) : null}
      {tool === "magnifier" && pointer ? <MagnifierLens x={pointer.x} y={pointer.y} pageRect={magnifierPageRect} /> : null}
    </>
  );
}

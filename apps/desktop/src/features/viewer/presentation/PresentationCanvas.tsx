import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/shared/lib/cn";
import { topDrawingAt, translateDrawing } from "@/shared/lib/drawingGeometry";
import { usePresentationStore, type Stroke, type StrokePoint } from "@/shared/store/presentationStore";
import { LiveStrokeCanvas, PageDrawingCanvas } from "./DrawingLayer";
import { DrawingSelectionFrame } from "./DrawingSelectionFrame";
import { beginDrawing, extendDrawing, isDrawingKept, makeDrawingId, type DrawStyle } from "./drawingGestures";
import { LaserTrail, type LaserPoint } from "./LaserTrail";
import { eraserCursor, highlighterCursor, penCursor } from "./toolCursor";
import { MagnifierLens } from "./MagnifierLens";
import { clampStrokePoint, measureTextBlock } from "./strokes";
import { TextDraft } from "./TextDraft";
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
const PICK_TOLERANCE_PX = 6;
const DRAWING_TOOLS = new Set(["pen", "highlighter", "shape", "eraser"]);
const NO_STROKES: Stroke[] = [];

type TextDraftState = { pageIndex: number; anchor: StrokePoint; initial: string; original: Stroke | null };
type MoveState = { pageIndex: number; original: Stroke; start: StrokePoint };

function pagePoint(rect: PageRect, x: number, y: number) {
  return clampStrokePoint({ x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height });
}

function rectSize(rect: PageRect) {
  return { width: rect.width, height: rect.height };
}

export function PresentationCanvas({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const tool = usePresentationStore((state) => state.tool);
  const penColor = usePresentationStore((state) => state.penColor);
  const penWidth = usePresentationStore((state) => state.penWidth);
  const highlighterWidth = usePresentationStore((state) => state.highlighterWidth);
  const penOpacity = usePresentationStore((state) => state.penOpacity);
  const shapeKind = usePresentationStore((state) => state.shapeKind);
  const textSize = usePresentationStore((state) => state.textSize);
  const selectedDrawing = usePresentationStore((state) => state.selectedDrawing);
  const selectedStroke = usePresentationStore((state) =>
    state.selectedDrawing && typeof state.selectedDrawing.surface === "number" ? state.strokesByPage[state.selectedDrawing.surface]?.find((stroke) => stroke.id === state.selectedDrawing?.id) : undefined,
  );
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
  const moveRef = useRef<MoveState | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraftState | null>(null);
  const [hoverMovable, setHoverMovable] = useState(false);

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
        const id = makeDrawingId();
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

  const pageStrokes = (pageIndex: number) => usePresentationStore.getState().strokesByPage[pageIndex] ?? NO_STROKES;

  const drawingAt = (rect: PageRect, point: StrokePoint) => topDrawingAt(pageStrokes(rect.pageIndex), point, PICK_TOLERANCE_PX, { x: rect.width, y: rect.height });

  const startText = (rect: PageRect, point: StrokePoint) => {
    const hit = drawingAt(rect, point);
    if (hit?.tool === "text") {
      usePresentationStore.getState().removeDrawing(rect.pageIndex, hit.id);
      setTextDraft({ pageIndex: rect.pageIndex, anchor: hit.points[0], initial: hit.text ?? "", original: hit });
      return;
    }
    setTextDraft({ pageIndex: rect.pageIndex, anchor: point, initial: "", original: null });
  };

  const commitText = (draft: TextDraftState, text: string) => {
    setTextDraft(null);
    const rect = pageRects.find((entry) => entry.pageIndex === draft.pageIndex);
    const trimmed = text.replace(/\s+$/, "");
    if (!rect || !trimmed.trim()) return;
    const sizePx = draft.original?.fontSize ? draft.original.fontSize * rect.width : textSize;
    const block = measureTextBlock(trimmed, sizePx);
    const opacity = draft.original ? draft.original.opacity : penOpacity < 1 ? penOpacity : undefined;
    addStroke(draft.pageIndex, {
      id: draft.original?.id ?? makeDrawingId("text"),
      tool: "text",
      color: draft.original?.color ?? penColor,
      width: 0,
      points: [draft.anchor],
      text: trimmed,
      fontSize: sizePx / rect.width,
      size: { width: block.width / rect.width, height: block.height / rect.height },
      ...(opacity !== undefined ? { opacity } : {}),
    });
  };

  const cancelText = (draft: TextDraftState) => {
    setTextDraft(null);
    if (draft.original) addStroke(draft.pageIndex, draft.original);
  };

  const drawStyle = (): DrawStyle => ({ tool: tool === "highlighter" ? "highlighter" : tool === "shape" ? "shape" : "pen", color: penColor, penWidth, highlighterWidth, penOpacity, shapeKind });

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
    if (tool === "text") {
      if (textDraft) return;
      const point = toContainerPoint(event);
      const pageRect = nearestPageRect(pageRects, point.x, point.y);
      if (!pageRect) return;
      event.preventDefault();
      startText(pageRect, pagePoint(pageRect, point.x, point.y));
      return;
    }
    if (tool === "select") {
      const point = toContainerPoint(event);
      const pageRect = nearestPageRect(pageRects, point.x, point.y);
      const normalized = pageRect ? pagePoint(pageRect, point.x, point.y) : null;
      const hit = pageRect && normalized ? drawingAt(pageRect, normalized) : null;
      if (!pageRect || !normalized || !hit) {
        usePresentationStore.getState().selectDrawing(null);
        return;
      }
      usePresentationStore.getState().selectDrawing({ surface: pageRect.pageIndex, id: hit.id });
      moveRef.current = { pageIndex: pageRect.pageIndex, original: hit, start: normalized };
      setHoverMovable(true);
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
    const stroke = beginDrawing(drawStyle(), normalized, rectSize(pageRect));
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
    if (tool === "select") {
      const point = toContainerPoint(event);
      const move = moveRef.current;
      if (move) {
        const pageRect = pageRects.find((rect) => rect.pageIndex === move.pageIndex);
        if (!pageRect) return;
        const normalized = pagePoint(pageRect, point.x, point.y);
        usePresentationStore.getState().replaceDrawing(move.pageIndex, translateDrawing(move.original, normalized.x - move.start.x, normalized.y - move.start.y));
        return;
      }
      const pageRect = pageRectAt(pageRects, point.x, point.y);
      setHoverMovable(!!pageRect && !!drawingAt(pageRect, pagePoint(pageRect, point.x, point.y)));
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
    const nextStroke = extendDrawing(current.stroke, normalized, rectSize(pageRect), event.shiftKey);
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
    if (tool === "select") {
      moveRef.current = null;
      return;
    }
    const current = drawingRef.current;
    const currentRect = current ? pageRects.find((rect) => rect.pageIndex === current.pageIndex) : undefined;
    if (current && currentRect && isDrawingKept(current.stroke, rectSize(currentRect))) addStroke(current.pageIndex, current.stroke);
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
    if (tool !== "select") {
      moveRef.current = null;
      setHoverMovable(false);
    }
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
            : tool === "text"
              ? "text"
              : tool === "select"
                ? hoverMovable
                  ? "move"
                  : "default"
                : "crosshair";

  const selectedRect = selectedDrawing && typeof selectedDrawing.surface === "number" ? pageRects.find((rect) => rect.pageIndex === selectedDrawing.surface) : undefined;
  const draftRect = textDraft ? pageRects.find((rect) => rect.pageIndex === textDraft.pageIndex) : undefined;

  const magnifierPageRect = pointer ? (() => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return pageRectAt(pageRects, pointer.x - rect.left, pointer.y - rect.top);
  })() : null;

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
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
          data-presentation-capture=""
          className="absolute inset-0 z-20"
          style={{ cursor: overlayCursor, touchAction: "none" }}
        />
      ) : null}
      {tool === "select" && selectedRect && selectedStroke ? (
        <DrawingSelectionFrame rect={selectedRect} stroke={selectedStroke} onDelete={() => usePresentationStore.getState().removeDrawing(selectedRect.pageIndex, selectedStroke.id)} />
      ) : null}
      {textDraft && draftRect ? (
        <TextDraft
          key={`${textDraft.pageIndex}-${textDraft.anchor.x}-${textDraft.anchor.y}`}
          left={draftRect.left + textDraft.anchor.x * draftRect.width}
          top={draftRect.top + textDraft.anchor.y * draftRect.height}
          color={textDraft.original?.color ?? penColor}
          sizePx={textDraft.original?.fontSize ? textDraft.original.fontSize * draftRect.width : textSize}
          opacity={textDraft.original ? (textDraft.original.opacity ?? 1) : penOpacity}
          initial={textDraft.initial}
          onCommit={(text) => commitText(textDraft, text)}
          onCancel={() => cancelText(textDraft)}
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

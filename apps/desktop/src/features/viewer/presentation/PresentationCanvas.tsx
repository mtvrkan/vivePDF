import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { topDrawingAt, translateDrawing } from "@/shared/lib/drawingGeometry";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore, type Stroke, type StrokePoint } from "@/shared/store/presentationStore";
import { LiveStrokeCanvas, PageDrawingCanvas } from "./DrawingLayer";
import { DrawingSelectionFrame } from "./DrawingSelectionFrame";
import { beginDrawing, extendDrawing, isDrawingKept, makeDrawingId, type DrawStyle } from "./drawingGestures";
import { editPresentationDrawing } from "./drawingInsert";
import { placedDrawing } from "./drawingPlacement";
import { duplicateDrawing } from "./drawingRotate";
import { LaserTrail, type LaserPoint } from "./LaserTrail";
import { toLivePoint, type LivePoint, type LiveSignal } from "./liveSignal";
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
const DRAG_THRESHOLD_PX = 3;
const DRAWING_TOOLS = new Set(["pen", "highlighter", "shape", "eraser"]);
const NO_STROKES: Stroke[] = [];

type TextDraftState = { pageIndex: number; anchor: StrokePoint; initial: string; original: Stroke | null };
type MoveState = { pageIndex: number; original: Stroke; start: StrokePoint; moved: boolean; editOnClick: boolean };

function pagePoint(rect: PageRect, x: number, y: number) {
  return clampStrokePoint({ x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height });
}

function rectSize(rect: PageRect) {
  return { width: rect.width, height: rect.height };
}

function activePageWidth(pageIndex: number): number | undefined {
  const { activeId, documents } = useDocumentStore.getState();
  return activeId ? documents[activeId]?.info?.pageSizes[pageIndex]?.width : undefined;
}

type PresentationCanvasProps = { containerRef: RefObject<HTMLDivElement | null>; contained?: boolean; onSignal?: (signal: LiveSignal) => void };

export function PresentationCanvas({ containerRef, contained = false, onSignal }: PresentationCanvasProps) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const penColor = usePresentationStore((state) => state.penColor);
  const penWidth = usePresentationStore((state) => state.penWidth);
  const highlighterWidth = usePresentationStore((state) => state.highlighterWidth);
  const penOpacity = usePresentationStore((state) => state.penOpacity);
  const shapeKind = usePresentationStore((state) => state.shapeKind);
  const textSize = usePresentationStore((state) => state.textSize);
  const selectedDrawing = usePresentationStore((state) => state.selectedDrawing);
  const placing = usePresentationStore((state) => state.placing);
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
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  const toContainerPoint = (event: { clientX: number; clientY: number }) => {
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

  const editText = (pageIndex: number, label: Stroke) => {
    const current = pageStrokes(pageIndex).find((stroke) => stroke.id === label.id) ?? label;
    usePresentationStore.getState().removeDrawing(pageIndex, current.id);
    setTextDraft({ pageIndex, anchor: current.points[0], initial: current.text ?? "", original: current });
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

  const placeAt = (point: { x: number; y: number }) => {
    const presentation = usePresentationStore.getState();
    const current = presentation.placing;
    const pageRect = current ? nearestPageRect(pageRects, point.x, point.y) : null;
    const asset = current ? presentation.drawingAssets[current.asset] : undefined;
    if (!current || !pageRect || !asset) return;
    const stroke = placedDrawing(asset, current.asset, pagePoint(pageRect, point.x, point.y), { ...rectSize(pageRect), widthPt: activePageWidth(pageRect.pageIndex) });
    presentation.cancelPlacement();
    if (!stroke) return;
    addStroke(pageRect.pageIndex, stroke);
    presentation.selectDrawing({ surface: pageRect.pageIndex, id: stroke.id });
  };

  const editDrawingAt = (event: React.MouseEvent) => {
    if (tool !== "select") return;
    const point = toContainerPoint(event);
    const pageRect = nearestPageRect(pageRects, point.x, point.y);
    const hit = pageRect ? drawingAt(pageRect, pagePoint(pageRect, point.x, point.y)) : null;
    if (pageRect && hit?.tool === "drawing") editPresentationDrawing(pageRect.pageIndex, hit);
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
      const normalized = pagePoint(pageRect, point.x, point.y);
      const hit = drawingAt(pageRect, normalized);
      if (hit?.tool === "text") {
        moveRef.current = { pageIndex: pageRect.pageIndex, original: hit, start: normalized, moved: false, editOnClick: true };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      setTextDraft({ pageIndex: pageRect.pageIndex, anchor: normalized, initial: "", original: null });
      return;
    }
    if (tool === "select" && usePresentationStore.getState().placing) {
      event.preventDefault();
      placeAt(toContainerPoint(event));
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
      moveRef.current = { pageIndex: pageRect.pageIndex, original: hit, start: normalized, moved: false, editOnClick: false };
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
    const move = moveRef.current;
    if (move) {
      const pageRect = pageRects.find((rect) => rect.pageIndex === move.pageIndex);
      if (!pageRect) return;
      const point = toContainerPoint(event);
      const normalized = pagePoint(pageRect, point.x, point.y);
      const dx = normalized.x - move.start.x;
      const dy = normalized.y - move.start.y;
      if (!move.moved && Math.hypot(dx * pageRect.width, dy * pageRect.height) < DRAG_THRESHOLD_PX) return;
      move.moved = true;
      usePresentationStore.getState().replaceDrawing(move.pageIndex, translateDrawing(move.original, dx, dy));
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
    if (tool === "select" || tool === "text") {
      const point = toContainerPoint(event);
      const pageRect = pageRectAt(pageRects, point.x, point.y);
      const hit = pageRect ? drawingAt(pageRect, pagePoint(pageRect, point.x, point.y)) : null;
      setHoverMovable(tool === "select" ? !!hit : hit?.tool === "text");
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
    const move = moveRef.current;
    if (move) {
      moveRef.current = null;
      if (move.editOnClick && !move.moved) editText(move.pageIndex, move.original);
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
    if (tool === "select") return;
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
    moveRef.current = null;
    setHoverMovable(false);
  }, [tool]);

  useEffect(() => {
    const emit = onSignalRef.current;
    if (!emit) return;
    const box = containerRef.current?.getBoundingClientRect();
    const toPage = (point: { x: number; y: number }) => toLivePoint(pageRects, point.x - (box?.left ?? 0), point.y - (box?.top ?? 0));
    const livePointer = pointer ? toPage(pointer) : null;
    const reference = pageRects.find((rect) => rect.pageIndex === livePointer?.pageIndex) ?? pageRects[0];
    emit({
      tool,
      pageWidth: reference?.width ?? 0,
      pointer: livePointer,
      laserPath: laserStroke ? laserStroke.map(toPage).filter((point): point is LivePoint => point !== null) : null,
      activeStroke,
    });
  }, [tool, pointer, laserStroke, activeStroke, pageRects, containerRef]);

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

  const toolCursor =
    tool === "laser" || tool === "spotlight" || tool === "magnifier"
      ? "none"
      : tool === "pen"
        ? penCursor(penColor)
        : tool === "highlighter"
          ? highlighterCursor(penColor)
          : tool === "eraser"
            ? eraserCursor("#1f2937")
            : tool === "text"
              ? hoverMovable
                ? "move"
                : "text"
              : tool === "select"
                ? hoverMovable
                  ? "move"
                  : "default"
                : "crosshair";
  const overlayCursor = placing ? "copy" : toolCursor;

  const selectedRect = selectedDrawing && typeof selectedDrawing.surface === "number" ? pageRects.find((rect) => rect.pageIndex === selectedDrawing.surface) : undefined;
  const draftRect = textDraft ? pageRects.find((rect) => rect.pageIndex === textDraft.pageIndex) : undefined;

  const containerBox = contained ? containerRef.current?.getBoundingClientRect() : undefined;
  const offsetX = containerBox?.left ?? 0;
  const offsetY = containerBox?.top ?? 0;
  const placement = contained ? "absolute" : "fixed";
  const toLocal = (points: LaserPoint[]) => (contained ? points.map((point) => ({ x: point.x - offsetX, y: point.y - offsetY })) : points);
  const stageRect = tool === "spotlight" && pointer ? containerRef.current?.getBoundingClientRect() : undefined;
  const stageBox = stageRect && contained ? { left: 0, top: 0, width: stageRect.width, height: stageRect.height } : stageRect;

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
          onDoubleClick={editDrawingAt}
          data-presentation-capture=""
          className="absolute inset-0 z-20"
          style={{ cursor: overlayCursor, touchAction: "none" }}
        />
      ) : null}
      {tool === "select" && selectedRect && selectedStroke ? (
        <DrawingSelectionFrame
          rect={selectedRect}
          stroke={selectedStroke}
          onChange={(stroke) => usePresentationStore.getState().replaceDrawing(selectedRect.pageIndex, stroke)}
          onDelete={() => usePresentationStore.getState().removeDrawing(selectedRect.pageIndex, selectedStroke.id)}
          onDuplicate={() => {
            const copy = duplicateDrawing(selectedStroke, { x: selectedRect.width, y: selectedRect.height });
            addStroke(selectedRect.pageIndex, copy);
            usePresentationStore.getState().selectDrawing({ surface: selectedRect.pageIndex, id: copy.id });
          }}
          onEdit={selectedStroke.tool === "drawing" ? () => editPresentationDrawing(selectedRect.pageIndex, selectedStroke) : undefined}
        />
      ) : null}
      {placing ? (
        <p role="status" className="glass pointer-events-none absolute inset-x-0 top-4 z-30 mx-auto w-fit rounded-full px-4 py-1.5 text-sm">
          {t("presentation.insert.placeHint")}
        </p>
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
      {laserStroke ? <LaserTrail points={toLocal(laserStroke)} color={laserColor} size={laserSize} contained={contained} /> : null}
      {fadingLasers.map((entry) => (
        <LaserTrail key={entry.id} points={toLocal(entry.points)} color={laserColor} size={laserSize} contained={contained} fading />
      ))}
      {tool === "laser" && pointer
        ? laserTrail.map((point, index) => (
            <span
              key={index}
              aria-hidden
              className={cn("laser-dot pointer-events-none z-40 -translate-x-1/2 -translate-y-1/2 rounded-full", placement)}
              style={{
                left: point.x - offsetX,
                top: point.y - offsetY,
                width: laserSize * (index === laserTrail.length - 1 ? 1 : 0.5),
                height: laserSize * (index === laserTrail.length - 1 ? 1 : 0.5),
                opacity: (index + 1) / laserTrail.length,
                background: `radial-gradient(circle, ${laserColor} 0%, transparent 70%)`,
                boxShadow: `0 0 ${laserSize}px ${laserSize / 2}px ${laserColor}88`,
              }}
            />
          ))
        : null}
      {stageBox ? (
        <div
          aria-hidden
          data-spotlight-frame=""
          className={cn("pointer-events-none z-30", placement)}
          style={{ left: stageBox.left, top: stageBox.top, width: stageBox.width, height: stageBox.height, boxShadow: "0 0 0 9999px rgb(0,0,0)" }}
        />
      ) : null}
      {tool === "spotlight" && pointer ? (
        <div
          aria-hidden
          className={cn("pointer-events-none z-30", placement, spotlightShape === "circle" ? "rounded-full" : "rounded-xl")}
          style={{
            left: pointer.x - offsetX - spotlightRadius,
            top: pointer.y - offsetY - (spotlightShape === "circle" ? spotlightRadius : spotlightRadius * SPOTLIGHT_RECT_RATIO),
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

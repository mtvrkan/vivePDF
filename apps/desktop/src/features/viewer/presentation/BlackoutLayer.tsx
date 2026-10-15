import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { topDrawingAt } from "@/shared/lib/drawingGeometry";
import { usePresentationStore, type BoardMode, type Stroke, type StrokePoint } from "@/shared/store/presentationStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { useBoardLiveStore, type BoardLiveStroke } from "./boardLiveStore";
import { DrawingItems } from "./DrawingLayer";
import { DrawingSelectionFrame } from "./DrawingSelectionFrame";
import { beginDrawing, extendDrawing, isDrawingKept, makeDrawingId } from "./drawingGestures";
import { editPresentationDrawing } from "./drawingInsert";
import { activePageWidth, movedDrawing, PICK_TOLERANCE_PX, type DrawingMove } from "./drawingMove";
import { placedDrawing } from "./drawingPlacement";
import { duplicateDrawing } from "./drawingRotate";
import { PlacementHint } from "./PlacementHint";
import { boardPageSize } from "./measure";
import { drawStroke, readableOnDark } from "./strokes";
import { eraserCursor, highlighterCursor, penCursor } from "./toolCursor";

const HINT_VISIBLE_MS = 4000;
const ERASER_RADIUS = 0.015;
const BOARD_TOOLS = new Set(["pen", "highlighter", "shape", "eraser"]);
const LAST_PAGE = -1;

function strokeColor(board: BoardMode, color: string) {
  return board === "black" ? readableOnDark(color) : color;
}

type Box = { left: number; top: number; width: number; height: number };

function windowBox(): Box {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function BoardCanvas({ board, strokes, live, width, height }: { board: BoardMode; strokes: Stroke[]; live: Stroke | null; width: number; height: number }) {
  const dpr = window.devicePixelRatio || 1;

  const setCanvasRef = (node: HTMLCanvasElement | null) => {
    if (!node) return;
    node.width = width * dpr;
    node.height = height * dpr;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const stroke of live ? [...strokes, live] : strokes) drawStroke(ctx, stroke, width, height, "normal", strokeColor(board, stroke.color));
  };

  return <canvas ref={setCanvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" key={`${strokes.length}-${live?.points.length ?? 0}-${width}-${height}`} />;
}

function Board({ board, contained, hint, remote }: { board: BoardMode; contained: boolean; hint: boolean; remote: BoardLiveStroke | null }) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const penColor = usePresentationStore((state) => state.penColor);
  const penWidth = usePresentationStore((state) => state.penWidth);
  const highlighterWidth = usePresentationStore((state) => state.highlighterWidth);
  const penOpacity = usePresentationStore((state) => state.penOpacity);
  const shapeKind = usePresentationStore((state) => state.shapeKind);
  const strokes = usePresentationStore((state) => state.boardStrokes[board]);
  const placing = usePresentationStore((state) => state.placing);
  const selectedId = usePresentationStore((state) => (state.selectedDrawing?.surface === board ? state.selectedDrawing.id : null));
  const editingItem = useViewerOverlayStore((state) => state.drawingEditor !== null);
  const [live, setLive] = useState<Stroke | null>(null);
  const [hoverMovable, setHoverMovable] = useState(false);
  const moveRef = useRef<DrawingMove | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const erasingRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const drawing = BOARD_TOOLS.has(tool);
  const selecting = tool === "select";
  const selected = selecting && selectedId ? strokes.find((stroke) => stroke.id === selectedId) : undefined;
  const items = strokes.filter((stroke) => stroke.tool === "drawing");

  useEffect(() => {
    const node = boardRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setSize((current) => (current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    useBoardLiveStore.getState().publish(live ? { board, stroke: live } : null);
  }, [board, live]);

  useEffect(() => () => useBoardLiveStore.getState().publish(null), []);

  useEffect(() => {
    moveRef.current = null;
    setHoverMovable(false);
  }, [tool]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHintVisible(false), HINT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const frame = (): Box => {
    const rect = boardRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : windowBox();
  };
  const pointOf = (event: PointerEvent | MouseEvent) => {
    const box = frame();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const surface = () => {
    const box = frame();
    return { width: box.width, height: box.height };
  };

  const itemAt = (point: StrokePoint) => {
    const box = surface();
    return topDrawingAt(usePresentationStore.getState().boardStrokes[board], point, PICK_TOLERANCE_PX, { x: box.width, y: box.height });
  };

  const placeAt = (point: StrokePoint) => {
    const presentation = usePresentationStore.getState();
    const current = presentation.placing;
    const asset = current ? presentation.drawingAssets[current.asset] : undefined;
    if (!current || !asset) return;
    const box = surface();
    const stroke = placedDrawing(asset, current.asset, point, { ...box, widthPt: activePageWidth(LAST_PAGE) });
    presentation.cancelPlacement();
    if (!stroke) return;
    presentation.addBoardStroke(board, stroke, box);
    presentation.selectDrawing({ surface: board, id: stroke.id });
  };

  const onSelectDown = (event: PointerEvent<HTMLDivElement>) => {
    const presentation = usePresentationStore.getState();
    const point = pointOf(event);
    if (presentation.placing) {
      event.preventDefault();
      placeAt(point);
      return;
    }
    const hit = itemAt(point);
    presentation.selectDrawing(hit ? { surface: board, id: hit.id } : null);
    if (!hit) return;
    moveRef.current = { original: hit, start: point, moved: false };
    setHoverMovable(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (selecting && event.button === 0) {
      onSelectDown(event);
      return;
    }
    if (!drawing || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (tool === "eraser") {
      erasingRef.current = true;
      usePresentationStore.getState().eraseBoardAt(board, pointOf(event), ERASER_RADIUS);
      return;
    }
    const style = { tool: tool === "highlighter" ? "highlighter" : tool === "shape" ? "shape" : "pen", color: penColor, penWidth, highlighterWidth, penOpacity, shapeKind } as const;
    const begun = beginDrawing(style, pointOf(event), surface(), makeDrawingId("board"));
    const pageSize = begun.tool === "measure" ? boardPageSize(surface()) : undefined;
    setLive(pageSize ? { ...begun, pageSize } : begun);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const move = moveRef.current;
    if (move) {
      const moved = movedDrawing(move, pointOf(event), surface());
      if (moved) usePresentationStore.getState().replaceDrawing(board, moved);
      return;
    }
    if (selecting) {
      setHoverMovable(itemAt(pointOf(event)) !== null);
      return;
    }
    if (erasingRef.current) {
      usePresentationStore.getState().eraseBoardAt(board, pointOf(event), ERASER_RADIUS);
      return;
    }
    if (!live) return;
    const point = pointOf(event);
    const constrain = event.shiftKey;
    setLive((stroke) => (stroke ? extendDrawing(stroke, point, surface(), constrain) : stroke));
  };

  const onPointerUp = () => {
    moveRef.current = null;
    erasingRef.current = false;
    const box = surface();
    if (live && isDrawingKept(live, box)) usePresentationStore.getState().addBoardStroke(board, live, box);
    setLive(null);
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!selecting) return;
    const hit = itemAt(pointOf(event));
    if (hit?.tool === "drawing") editPresentationDrawing(board, hit);
  };

  const duplicate = (stroke: Stroke) => {
    const box = surface();
    const copy = duplicateDrawing(stroke, { x: box.width, y: box.height });
    const presentation = usePresentationStore.getState();
    presentation.addBoardStroke(board, copy, box);
    presentation.selectDrawing({ surface: board, id: copy.id });
  };

  const frameRect = { pageIndex: LAST_PAGE, left: 0, top: 0, width: size.width, height: size.height };
  const selectCursor = placing ? "copy" : hoverMovable ? "move" : "default";
  const cursor = selecting ? selectCursor : tool === "shape" ? "crosshair" : tool === "pen" ? penCursor(strokeColor(board, penColor)) : tool === "highlighter" ? highlighterCursor(strokeColor(board, penColor)) : tool === "eraser" ? eraserCursor(board === "black" ? "#f8fafc" : "#1f2937") : undefined;

  return (
    <div
      ref={boardRef}
      data-presentation-board={board}
      className={cn("presentation-blackout inset-0", editingItem ? "z-30" : "z-50", contained ? "absolute" : "fixed", board === "black" ? "bg-black" : "bg-white")}
      style={{ cursor, touchAction: drawing || selecting ? "none" : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {items.length > 0 ? <DrawingItems rect={frameRect} items={items} /> : null}
      <BoardCanvas board={board} strokes={strokes} live={live ?? (remote?.board === board ? remote.stroke : null)} width={size.width} height={size.height} />
      {hint ? (
        <p
          role="status"
          className={cn(
            "pointer-events-none absolute inset-x-0 top-6 mx-auto w-fit rounded-full px-4 py-1.5 text-sm transition-opacity duration-(--transition-slow)",
            board === "black" ? "bg-white/10 text-white/80" : "bg-black/5 text-black/70",
            hintVisible ? "opacity-100" : "opacity-0",
          )}
        >
          {t("presentation.boardHint")}
        </p>
      ) : null}
      {placing ? <PlacementHint /> : null}
      {selected ? (
        <DrawingSelectionFrame
          rect={frameRect}
          stroke={selected}
          onChange={(stroke) => usePresentationStore.getState().replaceDrawing(board, stroke)}
          onDelete={() => usePresentationStore.getState().removeDrawing(board, selected.id)}
          onDuplicate={() => duplicate(selected)}
          onEdit={selected.tool === "drawing" ? () => editPresentationDrawing(board, selected) : undefined}
        />
      ) : null}
    </div>
  );
}

export function BlackoutLayer({ contained = false, hint = true, remote = null }: { contained?: boolean; hint?: boolean; remote?: BoardLiveStroke | null }) {
  const blackout = usePresentationStore((state) => state.blackout);
  if (blackout === "none") return null;
  return <Board key={blackout} board={blackout} contained={contained} hint={hint} remote={remote} />;
}

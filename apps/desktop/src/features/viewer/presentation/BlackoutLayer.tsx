import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore, type BoardMode, type Stroke } from "@/shared/store/presentationStore";
import { beginDrawing, extendDrawing, isDrawingKept, makeDrawingId } from "./drawingGestures";
import { drawStroke, readableOnDark } from "./strokes";
import { eraserCursor, highlighterCursor, penCursor } from "./toolCursor";

const HINT_VISIBLE_MS = 4000;
const ERASER_RADIUS = 0.015;
const BOARD_TOOLS = new Set(["pen", "highlighter", "shape", "eraser"]);

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

function Board({ board, contained, hint }: { board: BoardMode; contained: boolean; hint: boolean }) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const penColor = usePresentationStore((state) => state.penColor);
  const penWidth = usePresentationStore((state) => state.penWidth);
  const highlighterWidth = usePresentationStore((state) => state.highlighterWidth);
  const penOpacity = usePresentationStore((state) => state.penOpacity);
  const shapeKind = usePresentationStore((state) => state.shapeKind);
  const strokes = usePresentationStore((state) => state.boardStrokes[board]);
  const [live, setLive] = useState<Stroke | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const erasingRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const drawing = BOARD_TOOLS.has(tool);

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
    const timer = window.setTimeout(() => setHintVisible(false), HINT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const frame = (): Box => {
    const rect = boardRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : windowBox();
  };
  const pointOf = (event: PointerEvent) => {
    const box = frame();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const surface = () => {
    const box = frame();
    return { width: box.width, height: box.height };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (tool === "eraser") {
      erasingRef.current = true;
      usePresentationStore.getState().eraseBoardAt(board, pointOf(event), ERASER_RADIUS);
      return;
    }
    const style = { tool: tool === "highlighter" ? "highlighter" : tool === "shape" ? "shape" : "pen", color: penColor, penWidth, highlighterWidth, penOpacity, shapeKind } as const;
    setLive(beginDrawing(style, pointOf(event), surface(), makeDrawingId("board")));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
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
    erasingRef.current = false;
    const box = surface();
    if (live && isDrawingKept(live, box)) usePresentationStore.getState().addBoardStroke(board, live, box);
    setLive(null);
  };

  const cursor = tool === "shape" ? "crosshair" : tool === "pen" ? penCursor(strokeColor(board, penColor)) : tool === "highlighter" ? highlighterCursor(strokeColor(board, penColor)) : tool === "eraser" ? eraserCursor(board === "black" ? "#f8fafc" : "#1f2937") : undefined;

  return (
    <div
      ref={boardRef}
      data-presentation-board={board}
      className={cn("presentation-blackout inset-0 z-50", contained ? "absolute" : "fixed", board === "black" ? "bg-black" : "bg-white")}
      style={{ cursor, touchAction: drawing ? "none" : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <BoardCanvas board={board} strokes={strokes} live={live} width={size.width} height={size.height} />
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
    </div>
  );
}

export function BlackoutLayer({ contained = false, hint = true }: { contained?: boolean; hint?: boolean }) {
  const blackout = usePresentationStore((state) => state.blackout);
  if (blackout === "none") return null;
  return <Board key={blackout} board={blackout} contained={contained} hint={hint} />;
}

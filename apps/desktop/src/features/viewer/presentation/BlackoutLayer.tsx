import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore, type BoardMode, type Stroke } from "@/shared/store/presentationStore";
import { drawStroke, readableOnDark } from "./strokes";
import { eraserCursor, highlighterCursor, penCursor } from "./toolCursor";

const HINT_VISIBLE_MS = 4000;
const ERASER_RADIUS = 0.015;
const BOARD_WIDTH_FACTOR = 0.006;
const BOARD_TOOLS = new Set(["pen", "highlighter", "eraser"]);

function strokeColor(board: BoardMode, color: string) {
  return board === "black" ? readableOnDark(color) : color;
}

function BoardCanvas({ board, strokes, live }: { board: BoardMode; strokes: Stroke[]; live: Stroke | null }) {
  const width = window.innerWidth;
  const height = window.innerHeight;
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

function Board({ board }: { board: BoardMode }) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const penColor = usePresentationStore((state) => state.penColor);
  const penWidth = usePresentationStore((state) => state.penWidth);
  const strokes = usePresentationStore((state) => state.boardStrokes[board]);
  const [live, setLive] = useState<Stroke | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const erasingRef = useRef(false);
  const drawing = BOARD_TOOLS.has(tool);

  useEffect(() => {
    const timer = window.setTimeout(() => setHintVisible(false), HINT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const pointOf = (event: PointerEvent) => ({ x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (tool === "eraser") {
      erasingRef.current = true;
      usePresentationStore.getState().eraseBoardAt(board, pointOf(event), ERASER_RADIUS);
      return;
    }
    setLive({
      id: `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool: tool === "highlighter" ? "highlighter" : "pen",
      color: penColor,
      width: (tool === "highlighter" ? penWidth * 3 : penWidth) * BOARD_WIDTH_FACTOR,
      points: [pointOf(event)],
    });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (erasingRef.current) {
      usePresentationStore.getState().eraseBoardAt(board, pointOf(event), ERASER_RADIUS);
      return;
    }
    if (!live) return;
    const point = pointOf(event);
    setLive((stroke) => (stroke ? { ...stroke, points: [...stroke.points, point] } : stroke));
  };

  const onPointerUp = () => {
    erasingRef.current = false;
    if (live && live.points.length > 1) usePresentationStore.getState().addBoardStroke(board, live);
    setLive(null);
  };

  const cursor = tool === "pen" ? penCursor(strokeColor(board, penColor)) : tool === "highlighter" ? highlighterCursor(strokeColor(board, penColor)) : tool === "eraser" ? eraserCursor(board === "black" ? "#f8fafc" : "#1f2937") : undefined;

  return (
    <div
      data-presentation-board={board}
      className={cn("presentation-blackout fixed inset-0 z-50", board === "black" ? "bg-black" : "bg-white")}
      style={{ cursor, touchAction: drawing ? "none" : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <BoardCanvas board={board} strokes={strokes} live={live} />
      <p
        role="status"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-6 mx-auto w-fit rounded-full px-4 py-1.5 text-sm transition-opacity duration-(--transition-slow)",
          board === "black" ? "bg-white/10 text-white/80" : "bg-black/5 text-black/70",
          hintVisible ? "opacity-100" : "opacity-0",
        )}
      >
        {t("presentation.boardHint")}
      </p>
    </div>
  );
}

export function BlackoutLayer() {
  const blackout = usePresentationStore((state) => state.blackout);
  if (blackout === "none") return null;
  return <Board key={blackout} board={blackout} />;
}

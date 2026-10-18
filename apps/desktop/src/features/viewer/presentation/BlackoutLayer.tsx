import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { topDrawingAt } from "@/shared/lib/drawingGeometry";
import { bracketKey, shortcutLetter } from "@/shared/lib/shortcutKeys";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { usePresentationStore, type BoardMode, type Stroke, type StrokePoint } from "@/shared/store/presentationStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { hasOpenModal } from "../viewerKeyTarget";
import { BoardClearConfirm } from "./BoardClearConfirm";
import { boardSizeOf, boardSizePatch, boardStyleTool, stepBoardSize } from "./boardPresets";
import { clampSelectionOffset, mergeSelection, rectFromPoints, removeStrokes, selectionBounds, strokesInRect, toggleInSelection, translateStrokes, type NormalRect } from "./boardSelection";
import { BoardToolbar } from "./BoardToolbar";
import { useBoardLiveStore, type BoardLiveStroke } from "./boardLiveStore";
import { clearWithUndo } from "./drawingCleanup";
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
import { boardInk, eraserCursor, highlighterCursor, penCursor } from "./toolCursor";

const HINT_VISIBLE_MS = 4000;
const BOARD_TOOLS = new Set(["pen", "highlighter", "shape", "eraser"]);
const LAST_PAGE = -1;
const HALO_PX = 4;
const HALO_ALPHA = 0.55;
const NUDGE_STEP = 0.01;
const NUDGE_STEP_LARGE = 0.05;
const NO_OFFSET: StrokePoint = { x: 0, y: 0 };

type Marquee = { origin: StrokePoint; current: StrokePoint; additive: boolean; base: string[] };
type GroupMove = { origin: StrokePoint; offset: StrokePoint; ids: string[]; bounds: NormalRect };

function strokeColor(board: BoardMode, color: string) {
  return board === "black" ? readableOnDark(color) : color;
}

function arrowDelta(key: string, large: boolean): StrokePoint | null {
  const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP;
  if (key === "ArrowLeft") return { x: -step, y: 0 };
  if (key === "ArrowRight") return { x: step, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -step };
  if (key === "ArrowDown") return { x: 0, y: step };
  return null;
}

type Box = { left: number; top: number; width: number; height: number };

function windowBox(): Box {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function BoardCanvas({ board, strokes, live, width, height, selected }: { board: BoardMode; strokes: Stroke[]; live: Stroke | null; width: number; height: number; selected: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = window.devicePixelRatio || 1;
  const shape = `${strokes.length}-${live?.points.length ?? 0}-${width}-${height}`;
  const chosenKey = selected.join("\n");

  useLayoutEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    node.width = width * dpr;
    node.height = height * dpr;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const chosen = new Set(chosenKey ? chosenKey.split("\n") : []);
    const halo = chosen.size > 0 ? getComputedStyle(node).getPropertyValue("--primary").trim() : "";
    for (const stroke of live ? [...strokes, live] : strokes) {
      if (halo && chosen.has(stroke.id) && stroke.tool !== "drawing") {
        ctx.save();
        ctx.globalAlpha = HALO_ALPHA;
        drawStroke(ctx, { ...stroke, width: stroke.width + (HALO_PX * 2) / width }, width, height, "normal", halo);
        ctx.restore();
      }
      drawStroke(ctx, stroke, width, height, "normal", strokeColor(board, stroke.color));
    }
  }, [board, strokes, live, width, height, dpr, chosenKey, shape]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" key={shape} />;
}

function RectOutline({ rect, width, height, board, filled = false }: { rect: NormalRect; width: number; height: number; board: BoardMode; filled?: boolean }) {
  return (
    <div
      aria-hidden
      data-board-outline={filled ? "marquee" : "selection"}
      className={cn("pointer-events-none absolute rounded-sm border border-dashed", board === "black" ? "border-white/80" : "border-black/70", filled && "bg-primary/10")}
      style={{ left: rect.left * width, top: rect.top * height, width: (rect.right - rect.left) * width, height: (rect.bottom - rect.top) * height }}
    />
  );
}

function Board({ board, contained, hint, remote, controls }: { board: BoardMode; contained: boolean; hint: boolean; remote: BoardLiveStroke | null; controls: boolean }) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const pen = usePresentationStore((state) => state.boardPens[board]);
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
  const erasingRef = useRef<Stroke[] | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [group, setGroup] = useState<string[]>([]);
  const [marquee, setMarqueeState] = useState<Marquee | null>(null);
  const [groupMove, setGroupMoveState] = useState<GroupMove | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const groupMoveRef = useRef<GroupMove | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const drawing = BOARD_TOOLS.has(tool);
  const selecting = tool === "select";
  const selected = selecting && selectedId && group.length === 0 ? strokes.find((stroke) => stroke.id === selectedId) : undefined;

  const groupIds = useMemo(() => {
    const present = new Set(strokes.map((stroke) => stroke.id));
    return group.filter((id) => present.has(id));
  }, [group, strokes]);
  const selection = selecting ? (groupIds.length > 0 ? groupIds : selected ? [selected.id] : []) : [];
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const setMarquee = (next: Marquee | null) => {
    marqueeRef.current = next;
    setMarqueeState(next);
  };
  const setGroupMove = (next: GroupMove | null) => {
    groupMoveRef.current = next;
    setGroupMoveState(next);
  };

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
    const seal = () => usePresentationStore.getState().sealBoardHistory(board);
    window.addEventListener("keydown", seal, true);
    return () => window.removeEventListener("keydown", seal, true);
  }, [board]);

  useEffect(() => {
    moveRef.current = null;
    setHoverMovable(false);
    if (tool !== "select") setGroup([]);
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
  const eraserRadius = () => usePresentationStore.getState().boardPens[board].eraserSize / 2 / surface().width;

  const itemAt = (point: StrokePoint) => {
    const box = surface();
    return topDrawingAt(usePresentationStore.getState().boardStrokes[board], point, PICK_TOLERANCE_PX, { x: box.width, y: box.height });
  };

  const applySelection = (ids: string[]) => {
    const presentation = usePresentationStore.getState();
    if (ids.length === 1) {
      setGroup([]);
      presentation.selectDrawing({ surface: board, id: ids[0] });
      return;
    }
    presentation.selectDrawing(null);
    setGroup(ids);
  };

  const deleteSelection = () => {
    const ids = selectionRef.current;
    if (ids.length === 0) return;
    const presentation = usePresentationStore.getState();
    presentation.commitBoardStrokes(board, removeStrokes(presentation.boardStrokes[board], ids));
    presentation.selectDrawing(null);
    setGroup([]);
  };

  const moveSelection = (dx: number, dy: number) => {
    const ids = selectionRef.current;
    const presentation = usePresentationStore.getState();
    const current = presentation.boardStrokes[board];
    const bounds = selectionBounds(current, ids, surface());
    if (!bounds) return;
    const offset = clampSelectionOffset(bounds, dx, dy);
    presentation.commitBoardStrokes(board, translateStrokes(current, ids, offset.x, offset.y));
  };

  const keyActions = useRef({ deleteSelection, moveSelection, applySelection });
  keyActions.current = { deleteSelection, moveSelection, applySelection };

  useEffect(() => {
    if (!controls) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasOpenModal() || isTypingTarget(event.target)) return;
      const presentation = usePresentationStore.getState();
      const letter = shortcutLetter(event);
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.ctrlKey || event.metaKey) {
        if (event.altKey) return;
        if (letter === "z") {
          consume();
          if (event.shiftKey) presentation.redoBoard(board);
          else presentation.undoBoard(board);
        } else if (letter === "y" && !event.shiftKey) {
          consume();
          presentation.redoBoard(board);
        } else if (letter === "a" && !event.shiftKey) {
          consume();
          const ids = presentation.boardStrokes[board].map((stroke) => stroke.id);
          if (ids.length === 0) return;
          presentation.setTool("select");
          keyActions.current.applySelection(ids);
        }
        return;
      }
      if (event.altKey) return;
      const hasSelection = selectionRef.current.length > 0;
      if ((event.key === "Delete" || event.key === "Backspace") && hasSelection) {
        consume();
        keyActions.current.deleteSelection();
        return;
      }
      const nudge = arrowDelta(event.key, event.shiftKey);
      if (nudge && hasSelection) {
        consume();
        keyActions.current.moveSelection(nudge.x, nudge.y);
        return;
      }
      const bracket = bracketKey(event);
      const styleTool = boardStyleTool(presentation.tool);
      if (bracket && styleTool) {
        consume();
        const next = stepBoardSize(styleTool, boardSizeOf(presentation.boardPens[board], styleTool), bracket === "right" ? 1 : -1);
        presentation.setBoardPen(board, boardSizePatch(styleTool, next));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [board, controls]);

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
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const hit = itemAt(point);
    const current = selectionRef.current;
    if (hit && additive) {
      applySelection(toggleInSelection(current, hit.id));
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (hit && current.length > 1 && current.includes(hit.id)) {
      const bounds = selectionBounds(presentation.boardStrokes[board], current, surface());
      if (bounds) setGroupMove({ origin: point, offset: NO_OFFSET, ids: current, bounds });
      return;
    }
    if (hit) {
      setGroup([]);
      presentation.selectDrawing({ surface: board, id: hit.id });
      moveRef.current = { original: hit, start: point, moved: false };
      setHoverMovable(true);
      return;
    }
    const base = additive ? current : [];
    presentation.selectDrawing(null);
    setGroup(base);
    setMarquee({ origin: point, current: point, additive, base });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (selecting && event.button === 0) {
      onSelectDown(event);
      return;
    }
    if (!drawing || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (tool === "eraser") {
      erasingRef.current = usePresentationStore.getState().boardStrokes[board];
      usePresentationStore.getState().eraseBoardAt(board, pointOf(event), eraserRadius());
      return;
    }
    const style = { tool: tool === "highlighter" ? "highlighter" : tool === "shape" ? "shape" : "pen", color: tool === "highlighter" ? pen.highlighterColor : pen.penColor, penWidth: pen.penWidth, highlighterWidth: pen.highlighterWidth, penOpacity, shapeKind } as const;
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
    const sweep = marqueeRef.current;
    if (sweep) {
      const point = pointOf(event);
      const picked = strokesInRect(usePresentationStore.getState().boardStrokes[board], rectFromPoints(sweep.origin, point));
      setGroup(mergeSelection(sweep.base, picked, sweep.additive));
      setMarquee({ ...sweep, current: point });
      return;
    }
    const shift = groupMoveRef.current;
    if (shift) {
      const point = pointOf(event);
      setGroupMove({ ...shift, offset: clampSelectionOffset(shift.bounds, point.x - shift.origin.x, point.y - shift.origin.y) });
      return;
    }
    if (selecting) {
      setHoverMovable(itemAt(pointOf(event)) !== null);
      return;
    }
    if (erasingRef.current) {
      usePresentationStore.getState().eraseBoardAt(board, pointOf(event), eraserRadius());
      return;
    }
    if (!live) return;
    const point = pointOf(event);
    const constrain = event.shiftKey;
    setLive((stroke) => (stroke ? extendDrawing(stroke, point, surface(), constrain) : stroke));
  };

  const onPointerUp = () => {
    moveRef.current = null;
    if (marqueeRef.current) {
      setMarquee(null);
      applySelection(groupIds);
    }
    const shift = groupMoveRef.current;
    if (shift) {
      setGroupMove(null);
      const presentation = usePresentationStore.getState();
      presentation.commitBoardStrokes(board, translateStrokes(presentation.boardStrokes[board], shift.ids, shift.offset.x, shift.offset.y));
    }
    if (erasingRef.current) usePresentationStore.getState().recordBoardHistory(board, erasingRef.current);
    erasingRef.current = null;
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

  const offset = groupMove?.offset ?? NO_OFFSET;
  const shown = groupMove ? translateStrokes(strokes, groupMove.ids, offset.x, offset.y) : strokes;
  const items = shown.filter((stroke) => stroke.tool === "drawing");
  const groupBounds = groupIds.length > 1 && !marquee ? selectionBounds(shown, groupIds, size) : null;
  const frameRect = { pageIndex: LAST_PAGE, left: 0, top: 0, width: size.width, height: size.height };
  const selectCursor = placing ? "copy" : hoverMovable || groupMove ? "move" : "default";
  const cursor = selecting ? selectCursor : tool === "shape" ? "crosshair" : tool === "pen" ? penCursor(boardInk(board, tool, pen)) : tool === "highlighter" ? highlighterCursor(boardInk(board, tool, pen)) : tool === "eraser" ? eraserCursor(boardInk(board, tool, pen)) : undefined;
  const showToolbar = controls && !placing && !editingItem;

  return (
    <div
      ref={boardRef}
      data-presentation-board={board}
      className={cn("presentation-blackout inset-0", editingItem ? "z-30" : "z-50", contained ? "absolute" : "fixed", board === "black" ? "bg-black" : "bg-white")}
      style={{ cursor, touchAction: drawing || selecting ? "none" : undefined }}
      onPointerDownCapture={() => usePresentationStore.getState().sealBoardHistory(board)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {items.length > 0 ? <DrawingItems rect={frameRect} items={items} /> : null}
      <BoardCanvas board={board} strokes={shown} live={live ?? (remote?.board === board ? remote.stroke : null)} width={size.width} height={size.height} selected={groupIds} />
      {groupBounds ? <RectOutline rect={groupBounds} width={size.width} height={size.height} board={board} /> : null}
      {marquee ? <RectOutline rect={rectFromPoints(marquee.origin, marquee.current)} width={size.width} height={size.height} board={board} filled /> : null}
      {showToolbar ? <BoardToolbar board={board} selectedCount={selection.length} dimmed={live !== null || marquee !== null || groupMove !== null} onDeleteSelection={deleteSelection} onRequestClear={() => setConfirmClear(true)} /> : null}
      {controls ? (
        <p className="sr-only" aria-live="polite" data-testid="board-selection-status">
          {selection.length > 0 ? t("presentation.board.selectedCount", { count: selection.length }) : ""}
        </p>
      ) : null}
      {hint ? (
        <p
          role="status"
          className={cn(
            "pointer-events-none absolute inset-x-0 mx-auto w-fit rounded-full px-4 py-1.5 text-sm transition-opacity duration-(--transition-slow)",
            showToolbar ? "top-20" : "top-6",
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
      {confirmClear ? (
        <BoardClearConfirm
          count={strokes.length}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            setGroup([]);
            clearWithUndo(() => usePresentationStore.getState().clearBoard(board));
          }}
        />
      ) : null}
    </div>
  );
}

export function BlackoutLayer({ contained = false, hint = true, remote = null, controls = true }: { contained?: boolean; hint?: boolean; remote?: BoardLiveStroke | null; controls?: boolean }) {
  const blackout = usePresentationStore((state) => state.blackout);
  if (blackout === "none") return null;
  return <Board key={blackout} board={blackout} contained={contained} hint={hint} remote={remote} controls={controls} />;
}

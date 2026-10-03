import { create } from "zustand";
import type { CodeBlock } from "@/types";

export type PresentationTool = "pointer" | "laser" | "pen" | "highlighter" | "eraser" | "spotlight" | "magnifier";
export type BlackoutMode = "none" | "black" | "white";
export type BoardMode = Exclude<BlackoutMode, "none">;
export type DrawingsMode = "temporary" | "annotations";
export type LensShape = "circle" | "rect";
export type StrokePoint = { x: number; y: number };
export type Stroke = { id: string; tool: "pen" | "highlighter"; color: string; width: number; points: StrokePoint[] };
export type DrawingSnapshot = { strokesByPage: Record<number, Stroke[]>; boardStrokes: Record<BoardMode, Stroke[]> };
export type CodeBlockCache = { width: number; height: number; blocks: CodeBlock[] };

const STORAGE_KEY = "vivepdf.presentation";
const SPOTLIGHT_MIN = 80;
const SPOTLIGHT_MAX = 400;
const MAGNIFIER_ZOOM_MIN = 1.5;
const MAGNIFIER_ZOOM_MAX = 6;
const MIN_PIECE_LENGTH = 0.002;

type PersistedPrefs = {
  penColor: string;
  penWidth: number;
  laserColor: string;
  laserSize: number;
  spotlightRadius: number;
  spotlightShape: LensShape;
  spotlightDim: number;
  magnifierSize: number;
  magnifierZoom: number;
  magnifierShape: LensShape;
  showClock: boolean;
  showTimer: boolean;
  cursorAutoHide: boolean;
  drawingsMode: DrawingsMode;
};

const DEFAULT_PREFS: PersistedPrefs = {
  penColor: "#E5484D",
  penWidth: 3,
  laserColor: "#E5484D",
  laserSize: 8,
  spotlightRadius: 180,
  spotlightShape: "circle",
  spotlightDim: 0.78,
  magnifierSize: 220,
  magnifierZoom: 2.5,
  magnifierShape: "circle",
  showClock: false,
  showTimer: false,
  cursorAutoHide: true,
  drawingsMode: "temporary",
};

export function readPrefs(): PersistedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<PersistedPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function persistPrefs(prefs: PersistedPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    void 0;
  }
}

type PresentationState = {
  tool: PresentationTool;
  penColor: string;
  penWidth: number;
  laserColor: string;
  laserSize: number;
  spotlightRadius: number;
  spotlightShape: LensShape;
  spotlightDim: number;
  magnifierSize: number;
  magnifierZoom: number;
  magnifierShape: LensShape;
  blackout: BlackoutMode;
  timerRunning: boolean;
  timerStartedAt: number | null;
  timerElapsedMs: number;
  showClock: boolean;
  showTimer: boolean;
  cursorAutoHide: boolean;
  drawingsMode: DrawingsMode;
  strokesByPage: Record<number, Stroke[]>;
  redoByPage: Record<number, Stroke[]>;
  boardStrokes: Record<BoardMode, Stroke[]>;
  codeBlocksByPage: Record<number, CodeBlockCache | undefined>;
  codeBlockOpen: { pageIndex: number; blockId: string } | null;
  overviewOpen: boolean;
  setOverviewOpen: (open: boolean) => void;
  toggleOverview: () => void;
  setTool: (tool: PresentationTool) => void;
  setPenColor: (color: string) => void;
  setPenWidth: (width: number) => void;
  setLaserColor: (color: string) => void;
  setLaserSize: (size: number) => void;
  setSpotlightRadius: (radius: number) => void;
  nudgeSpotlightRadius: (delta: number) => void;
  setSpotlightShape: (shape: LensShape) => void;
  setSpotlightDim: (dim: number) => void;
  setMagnifierSize: (size: number) => void;
  setMagnifierZoom: (zoom: number) => void;
  nudgeMagnifierZoom: (delta: number) => void;
  setMagnifierShape: (shape: LensShape) => void;
  setBlackout: (mode: BlackoutMode) => void;
  toggleBlackout: (mode: Exclude<BlackoutMode, "none">) => void;
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  toggleTimerRunning: () => void;
  toggleClock: () => void;
  toggleTimerVisible: () => void;
  toggleCursorAutoHide: () => void;
  setDrawingsMode: (mode: DrawingsMode) => void;
  resetPrefs: () => void;
  addStroke: (pageIndex: number, stroke: Stroke) => void;
  undoStroke: (pageIndex: number) => void;
  redoStroke: (pageIndex: number) => void;
  eraseAt: (pageIndex: number, point: StrokePoint, radius: number) => void;
  clearPage: (pageIndex: number) => void;
  clearAllDrawings: () => void;
  addBoardStroke: (board: BoardMode, stroke: Stroke) => void;
  eraseBoardAt: (board: BoardMode, point: StrokePoint, radius: number) => void;
  clearBoard: (board: BoardMode) => void;
  clearVisible: (pageIndex: number) => void;
  restoreDrawings: (snapshot: DrawingSnapshot) => void;
  visibleStrokeCount: (pageIndex: number) => number;
  totalStrokeCount: () => number;
  setCodeBlocksForPage: (pageIndex: number, entry: CodeBlockCache) => void;
  openCodeBlock: (pageIndex: number, blockId: string) => void;
  closeCodeBlock: () => void;
  resetSession: () => void;
};

function distanceToSegment(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function strokeHit(stroke: Stroke, point: StrokePoint, radius: number): boolean {
  const threshold = radius + stroke.width / 2;
  for (let i = 0; i < stroke.points.length - 1; i += 1) {
    if (distanceToSegment(point, stroke.points[i], stroke.points[i + 1]) <= threshold) return true;
  }
  return stroke.points.length === 1 && Math.hypot(stroke.points[0].x - point.x, stroke.points[0].y - point.y) <= threshold;
}

function outsideSpans(a: StrokePoint, b: StrokePoint, center: StrokePoint, radius: number): Array<[number, number]> {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const qa = dx * dx + dy * dy;
  const qc = fx * fx + fy * fy - radius * radius;
  if (qa === 0) return qc > 0 ? [[0, 1]] : [];
  const qb = 2 * (fx * dx + fy * dy);
  const disc = qb * qb - 4 * qa * qc;
  if (disc <= 0) return [[0, 1]];
  const root = Math.sqrt(disc);
  const enter = (-qb - root) / (2 * qa);
  const leave = (-qb + root) / (2 * qa);
  if (leave <= 0 || enter >= 1) return [[0, 1]];
  const spans: Array<[number, number]> = [];
  if (enter > 0) spans.push([0, enter]);
  if (leave < 1) spans.push([leave, 1]);
  return spans;
}

function pointOnSegment(a: StrokePoint, b: StrokePoint, t: number): StrokePoint {
  if (t === 0) return a;
  if (t === 1) return b;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function polylineLength(points: StrokePoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

export function eraseFromStroke(stroke: Stroke, point: StrokePoint, radius: number): Stroke[] | null {
  if (!strokeHit(stroke, point, radius)) return null;
  if (stroke.points.length < 2) return [];
  const threshold = radius + stroke.width / 2;
  const pieces: StrokePoint[][] = [];
  let current: StrokePoint[] | null = null;
  for (let i = 0; i < stroke.points.length - 1; i += 1) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    const spans = outsideSpans(a, b, point, threshold);
    if (spans.length === 0) current = null;
    for (const [start, end] of spans) {
      if (start > 0 || !current) {
        current = [pointOnSegment(a, b, start)];
        pieces.push(current);
      }
      current.push(pointOnSegment(a, b, end));
      if (end < 1) current = null;
    }
  }
  return pieces
    .filter((points) => points.length > 1 && polylineLength(points) >= MIN_PIECE_LENGTH)
    .map((points, index) => ({ ...stroke, id: `${stroke.id}~${index}`, points }));
}

export function eraseFromStrokes(strokes: Stroke[], point: StrokePoint, radius: number): Stroke[] {
  let changed = false;
  const next = strokes.flatMap((stroke) => {
    const pieces = eraseFromStroke(stroke, point, radius);
    if (!pieces) return [stroke];
    changed = true;
    return pieces;
  });
  return changed ? next : strokes;
}

const initialPrefs = readPrefs();

export const usePresentationStore = create<PresentationState>((set, get) => ({
  tool: "pointer",
  penColor: initialPrefs.penColor,
  penWidth: initialPrefs.penWidth,
  laserColor: initialPrefs.laserColor,
  laserSize: initialPrefs.laserSize,
  spotlightRadius: initialPrefs.spotlightRadius,
  spotlightShape: initialPrefs.spotlightShape,
  spotlightDim: initialPrefs.spotlightDim,
  magnifierSize: initialPrefs.magnifierSize,
  magnifierZoom: initialPrefs.magnifierZoom,
  magnifierShape: initialPrefs.magnifierShape,
  blackout: "none",
  timerRunning: false,
  timerStartedAt: null,
  timerElapsedMs: 0,
  showClock: initialPrefs.showClock,
  showTimer: initialPrefs.showTimer,
  cursorAutoHide: initialPrefs.cursorAutoHide,
  drawingsMode: initialPrefs.drawingsMode,
  strokesByPage: {},
  redoByPage: {},
  boardStrokes: { black: [], white: [] },
  codeBlocksByPage: {},
  codeBlockOpen: null,
  overviewOpen: false,

  setOverviewOpen: (open) => set({ overviewOpen: open }),
  toggleOverview: () => set((state) => ({ overviewOpen: !state.overviewOpen })),
  setTool: (tool) => set({ tool }),

  setPenColor: (color) => {
    persistPrefs({ ...readPrefs(), penColor: color });
    set({ penColor: color });
  },
  setPenWidth: (width) => {
    persistPrefs({ ...readPrefs(), penWidth: width });
    set({ penWidth: width });
  },
  setLaserColor: (color) => {
    persistPrefs({ ...readPrefs(), laserColor: color });
    set({ laserColor: color });
  },
  setLaserSize: (size) => {
    persistPrefs({ ...readPrefs(), laserSize: size });
    set({ laserSize: size });
  },
  setSpotlightRadius: (radius) => {
    const clamped = Math.round(Math.max(SPOTLIGHT_MIN, Math.min(SPOTLIGHT_MAX, radius)));
    persistPrefs({ ...readPrefs(), spotlightRadius: clamped });
    set({ spotlightRadius: clamped });
  },
  nudgeSpotlightRadius: (delta) => get().setSpotlightRadius(get().spotlightRadius + delta),
  setSpotlightShape: (shape) => {
    persistPrefs({ ...readPrefs(), spotlightShape: shape });
    set({ spotlightShape: shape });
  },
  setSpotlightDim: (dim) => {
    const clamped = Math.max(0.3, Math.min(0.95, dim));
    persistPrefs({ ...readPrefs(), spotlightDim: clamped });
    set({ spotlightDim: clamped });
  },
  setMagnifierSize: (size) => {
    persistPrefs({ ...readPrefs(), magnifierSize: size });
    set({ magnifierSize: size });
  },
  setMagnifierZoom: (zoom) => {
    const clamped = Math.round(Math.max(MAGNIFIER_ZOOM_MIN, Math.min(MAGNIFIER_ZOOM_MAX, zoom)) * 10) / 10;
    persistPrefs({ ...readPrefs(), magnifierZoom: clamped });
    set({ magnifierZoom: clamped });
  },
  nudgeMagnifierZoom: (delta) => get().setMagnifierZoom(get().magnifierZoom + delta),
  setMagnifierShape: (shape) => {
    persistPrefs({ ...readPrefs(), magnifierShape: shape });
    set({ magnifierShape: shape });
  },

  setBlackout: (mode) => set({ blackout: mode }),
  toggleBlackout: (mode) => set((state) => ({ blackout: state.blackout === mode ? "none" : mode })),

  startTimer: () =>
    set((state) => (state.timerRunning ? state : { timerRunning: true, timerStartedAt: Date.now() - state.timerElapsedMs })),
  pauseTimer: () =>
    set((state) => {
      if (!state.timerRunning || state.timerStartedAt === null) return state;
      return { timerRunning: false, timerElapsedMs: Date.now() - state.timerStartedAt, timerStartedAt: null };
    }),
  resetTimer: () => set({ timerRunning: false, timerStartedAt: null, timerElapsedMs: 0 }),
  toggleTimerRunning: () => (get().timerRunning ? get().pauseTimer() : get().startTimer()),

  toggleClock: () => {
    const next = !get().showClock;
    persistPrefs({ ...readPrefs(), showClock: next });
    set({ showClock: next });
  },
  toggleTimerVisible: () => {
    const next = !get().showTimer;
    persistPrefs({ ...readPrefs(), showTimer: next });
    set({ showTimer: next });
  },
  toggleCursorAutoHide: () => {
    const next = !get().cursorAutoHide;
    persistPrefs({ ...readPrefs(), cursorAutoHide: next });
    set({ cursorAutoHide: next });
  },
  setDrawingsMode: (mode) => {
    persistPrefs({ ...readPrefs(), drawingsMode: mode });
    set({ drawingsMode: mode });
  },
  resetPrefs: () => {
    persistPrefs(DEFAULT_PREFS);
    set({ ...DEFAULT_PREFS });
  },

  addStroke: (pageIndex, stroke) =>
    set((state) => ({
      strokesByPage: { ...state.strokesByPage, [pageIndex]: [...(state.strokesByPage[pageIndex] ?? []), stroke] },
      redoByPage: { ...state.redoByPage, [pageIndex]: [] },
    })),
  undoStroke: (pageIndex) =>
    set((state) => {
      const strokes = state.strokesByPage[pageIndex] ?? [];
      if (strokes.length === 0) return state;
      const last = strokes[strokes.length - 1];
      return {
        strokesByPage: { ...state.strokesByPage, [pageIndex]: strokes.slice(0, -1) },
        redoByPage: { ...state.redoByPage, [pageIndex]: [...(state.redoByPage[pageIndex] ?? []), last] },
      };
    }),
  redoStroke: (pageIndex) =>
    set((state) => {
      const redo = state.redoByPage[pageIndex] ?? [];
      if (redo.length === 0) return state;
      const last = redo[redo.length - 1];
      return {
        redoByPage: { ...state.redoByPage, [pageIndex]: redo.slice(0, -1) },
        strokesByPage: { ...state.strokesByPage, [pageIndex]: [...(state.strokesByPage[pageIndex] ?? []), last] },
      };
    }),
  eraseAt: (pageIndex, point, radius) =>
    set((state) => {
      const strokes = state.strokesByPage[pageIndex] ?? [];
      const remaining = eraseFromStrokes(strokes, point, radius);
      if (remaining === strokes) return state;
      return { strokesByPage: { ...state.strokesByPage, [pageIndex]: remaining } };
    }),
  clearPage: (pageIndex) =>
    set((state) => ({
      strokesByPage: { ...state.strokesByPage, [pageIndex]: [] },
      redoByPage: { ...state.redoByPage, [pageIndex]: [] },
    })),
  clearAllDrawings: () => set({ strokesByPage: {}, redoByPage: {}, boardStrokes: { black: [], white: [] } }),
  addBoardStroke: (board, stroke) => set((state) => ({ boardStrokes: { ...state.boardStrokes, [board]: [...state.boardStrokes[board], stroke] } })),
  eraseBoardAt: (board, point, radius) =>
    set((state) => {
      const strokes = state.boardStrokes[board];
      const remaining = eraseFromStrokes(strokes, point, radius);
      return remaining === strokes ? state : { boardStrokes: { ...state.boardStrokes, [board]: remaining } };
    }),
  clearBoard: (board) => set((state) => ({ boardStrokes: { ...state.boardStrokes, [board]: [] } })),
  clearVisible: (pageIndex) => {
    const { blackout, clearBoard, clearPage } = get();
    if (blackout === "none") clearPage(pageIndex);
    else clearBoard(blackout);
  },
  restoreDrawings: (snapshot) =>
    set((state) => {
      const strokesByPage = { ...state.strokesByPage };
      for (const [page, strokes] of Object.entries(snapshot.strokesByPage)) {
        const pageIndex = Number(page);
        const current = strokesByPage[pageIndex] ?? [];
        const ids = new Set(current.map((stroke) => stroke.id));
        strokesByPage[pageIndex] = [...strokes.filter((stroke) => !ids.has(stroke.id)), ...current];
      }
      const board = (mode: BoardMode) => {
        const ids = new Set(state.boardStrokes[mode].map((stroke) => stroke.id));
        return [...snapshot.boardStrokes[mode].filter((stroke) => !ids.has(stroke.id)), ...state.boardStrokes[mode]];
      };
      return { strokesByPage, boardStrokes: { black: board("black"), white: board("white") } };
    }),
  visibleStrokeCount: (pageIndex) => {
    const { blackout, boardStrokes, strokesByPage } = get();
    return blackout === "none" ? (strokesByPage[pageIndex]?.length ?? 0) : boardStrokes[blackout].length;
  },
  totalStrokeCount: () => {
    const { strokesByPage, boardStrokes } = get();
    return Object.values(strokesByPage).reduce((sum, strokes) => sum + strokes.length, 0) + boardStrokes.black.length + boardStrokes.white.length;
  },

  setCodeBlocksForPage: (pageIndex, entry) =>
    set((state) => ({ codeBlocksByPage: { ...state.codeBlocksByPage, [pageIndex]: entry } })),
  openCodeBlock: (pageIndex, blockId) => set({ codeBlockOpen: { pageIndex, blockId } }),
  closeCodeBlock: () => set({ codeBlockOpen: null }),

  resetSession: () =>
    set({
      tool: "pointer",
      blackout: "none",
      timerRunning: false,
      timerStartedAt: null,
      timerElapsedMs: 0,
      strokesByPage: {},
      redoByPage: {},
      boardStrokes: { black: [], white: [] },
      codeBlocksByPage: {},
      codeBlockOpen: null,
      overviewOpen: false,
    }),
}));

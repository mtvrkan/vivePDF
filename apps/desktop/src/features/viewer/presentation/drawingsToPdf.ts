import type { BoardMode, DrawingSnapshot, Stroke } from "@/shared/store/presentationStore";
import type { PresentationBoardDrawings, PresentationPageDrawings, PresentationStrokeSpec } from "@/types";
import { readableOnDark } from "./strokes";

export type BoardSize = { width: number; height: number };
export type PresentationDrawings = { pages: PresentationPageDrawings[]; boards: PresentationBoardDrawings[] };

const BOARDS: readonly BoardMode[] = ["black", "white"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FALLBACK_COLOR = "#000000";
const MAX_POINTS = 20000;
const MAX_STROKES = 2000;

function thinned(points: Stroke["points"]): [number, number][] {
  const step = Math.ceil(points.length / MAX_POINTS);
  const kept = step > 1 ? points.filter((_, index) => index % step === 0 || index === points.length - 1) : points;
  return kept.map((point) => [point.x, point.y]);
}

function strokeSpec(stroke: Stroke, color: string): PresentationStrokeSpec | null {
  if (stroke.points.length === 0 || stroke.tool === "drawing") return null;
  const base: PresentationStrokeSpec = {
    tool: stroke.tool,
    color: HEX_COLOR.test(color) ? color : FALLBACK_COLOR,
    width: Math.min(1, Math.max(0, stroke.width)),
    points: thinned(stroke.points),
    ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}),
  };
  if (stroke.tool !== "text") return base;
  if (!stroke.text?.trim() || !stroke.fontSize || !stroke.size) return null;
  return { ...base, text: stroke.text, fontSize: stroke.fontSize, size: [stroke.size.width, stroke.size.height] };
}

function specs(strokes: readonly Stroke[], recolor: (color: string) => string = (color) => color): PresentationStrokeSpec[] {
  return strokes.map((stroke) => strokeSpec(stroke, recolor(stroke.color))).filter((spec): spec is PresentationStrokeSpec => spec !== null);
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += MAX_STROKES) out.push(items.slice(start, start + MAX_STROKES));
  return out;
}

export function presentationDrawings(snapshot: DrawingSnapshot, board: BoardSize): PresentationDrawings {
  const pages = Object.entries(snapshot.strokesByPage)
    .map(([index, strokes]) => ({ page: Number(index) + 1, strokes: specs(strokes) }))
    .filter((entry) => Number.isInteger(entry.page) && entry.page > 0)
    .sort((a, b) => a.page - b.page)
    .flatMap((entry) => chunks(entry.strokes).map((strokes) => ({ page: entry.page, strokes })));
  const boards = BOARDS.flatMap((background) =>
    chunks(specs(snapshot.boardStrokes[background], background === "black" ? readableOnDark : undefined)).map((strokes) => ({ background, width: board.width, height: board.height, strokes })),
  );
  return { pages, boards };
}

export function hasPresentationDrawings(drawings: PresentationDrawings): boolean {
  return drawings.pages.length > 0 || drawings.boards.length > 0;
}

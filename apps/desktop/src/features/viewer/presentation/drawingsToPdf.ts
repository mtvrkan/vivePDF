import { drawingSvg } from "@/features/viewer/overlay/drawing/drawingSource";
import type { BoardMode, DrawingAsset, DrawingSnapshot, Stroke } from "@/shared/store/presentationStore";
import type { PresentationBoardDrawings, PresentationPageDrawings, PresentationStrokeSpec } from "@/types";
import { insertedSourceOf } from "./insertedSource";
import { measureLayout } from "./measure";
import { measureTextBlock, readableOnDark, TEXT_LINE_HEIGHT } from "./strokes";

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

type Assets = Record<string, DrawingAsset> | undefined;

function drawingSpec(stroke: Stroke, assets: Assets): PresentationStrokeSpec | null {
  const asset = stroke.asset ? assets?.[stroke.asset] : undefined;
  const anchor = stroke.points[0];
  if (!asset?.drawing || !stroke.size || !anchor) return null;
  const source = insertedSourceOf(asset.drawing);
  return {
    tool: "drawing",
    color: FALLBACK_COLOR,
    width: 0,
    points: [[anchor.x, anchor.y]],
    size: [stroke.size.width, stroke.size.height],
    svg: drawingSvg(asset.drawing),
    ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}),
    ...(source ? { source } : {}),
  };
}

function measureSpecs(stroke: Stroke, base: Omit<PresentationStrokeSpec, "tool">): PresentationStrokeSpec[] {
  const surface = stroke.pageSize ?? { width: 1, height: 1 };
  const layout = measureLayout(stroke, surface.width, surface.height);
  const line: PresentationStrokeSpec = { ...base, tool: "line", points: base.points.slice(0, 2) };
  if (!layout) return [line];
  const normalized = (point: { x: number; y: number }): [number, number] => [point.x / surface.width, point.y / surface.height];
  const ticks = layout.ticks.map(([from, to]): PresentationStrokeSpec => ({ ...base, tool: "line", points: [normalized(from), normalized(to)] }));
  if (!layout.label || !stroke.pageSize) return [line, ...ticks];
  const block = measureTextBlock(layout.label, layout.fontPx);
  const leading = ((TEXT_LINE_HEIGHT - 1) / 2) * layout.fontPx;
  const anchor = normalized({ x: layout.labelCenter.x - block.width / 2, y: layout.labelCenter.y - block.height / 2 - leading });
  const label: PresentationStrokeSpec = {
    ...base,
    tool: "text",
    width: 0,
    points: [anchor],
    text: layout.label,
    fontSize: layout.fontPx / surface.width,
    size: [block.width / surface.width, block.height / surface.height],
  };
  return [line, ...ticks, label];
}

function strokeSpecs(stroke: Stroke, color: string, assets: Assets): PresentationStrokeSpec[] {
  if (stroke.tool !== "measure") {
    const spec = strokeSpec(stroke, color, assets);
    return spec ? [spec] : [];
  }
  if (stroke.points.length < 2) return [];
  return measureSpecs(stroke, {
    color: HEX_COLOR.test(color) ? color : FALLBACK_COLOR,
    width: Math.min(1, Math.max(0, stroke.width)),
    points: thinned(stroke.points),
    ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}),
  });
}

function strokeSpec(stroke: Stroke, color: string, assets: Assets): PresentationStrokeSpec | null {
  if (stroke.tool === "drawing") return drawingSpec(stroke, assets);
  if (stroke.points.length === 0 || stroke.tool === "measure") return null;
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

function specs(strokes: readonly Stroke[], assets: Assets, recolor: (color: string) => string = (color) => color): PresentationStrokeSpec[] {
  return strokes.flatMap((stroke) => strokeSpecs(stroke, recolor(stroke.color), assets));
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += MAX_STROKES) out.push(items.slice(start, start + MAX_STROKES));
  return out;
}

export function presentationDrawings(snapshot: DrawingSnapshot, board: BoardSize): PresentationDrawings {
  const pages = Object.entries(snapshot.strokesByPage)
    .map(([index, strokes]) => ({ page: Number(index) + 1, strokes: specs(strokes, snapshot.drawingAssets) }))
    .filter((entry) => Number.isInteger(entry.page) && entry.page > 0)
    .sort((a, b) => a.page - b.page)
    .flatMap((entry) => chunks(entry.strokes).map((strokes) => ({ page: entry.page, strokes })));
  const boards = BOARDS.flatMap((background) =>
    chunks(specs(snapshot.boardStrokes[background], snapshot.drawingAssets, background === "black" ? readableOnDark : undefined)).map((strokes) => ({ background, width: board.width, height: board.height, strokes })),
  );
  return { pages, boards };
}

export function hasPresentationDrawings(drawings: PresentationDrawings): boolean {
  return drawings.pages.length > 0 || drawings.boards.length > 0;
}

import type { Point, Primitive } from "../shapes/primitives";
import type { ShapeStyle } from "../shapes/render";
import { compile, parseExpression, toLatex, type ParseResult } from "./expression";

export type GraphFunction = { expression: string; color: string };
export type GraphSettings = { functions: GraphFunction[]; xMin: number; xMax: number; autoY: boolean; yMin: number; yMax: number; grid: boolean; legend: boolean; equalScale: boolean };
export type Range = { min: number; max: number };
export type GraphPlan = { primitives: Primitive[]; x: Range; y: Range; parsed: ParseResult[] };

export const PLOT_WIDTH = 320;
export const PLOT_HEIGHT = 240;
export const MAX_FUNCTIONS = 4;
export const RANGE_LIMIT = 1_000_000;
export const LEGEND_NAMES = ["f", "g", "h", "p"];
export const FUNCTION_COLORS = ["#1d4ed8", "#dc2626", "#15803d", "#9333ea"];
const SAMPLES = 720;
const GRID_COLOR = "#d4d4d8";
const TICK_SCALE = 0.72;
const DEFAULT_RANGE: Range = { min: -5, max: 5 };

export const GRAPH_STYLE: ShapeStyle = { stroke: "#111111", fill: null, weight: 1, labels: true };
export const GRAPH_EXAMPLES = ["x^2", "x^3 - 3x", "sin x", "cos x", "1/x", "e^x", "ln x", "sqrt x", "|x|"];
export const DEFAULT_GRAPH: GraphSettings = { functions: [{ expression: "x^2 - 2", color: FUNCTION_COLORS[0] }], xMin: -5, xMax: 5, autoY: true, yMin: -5, yMax: 5, grid: true, legend: true, equalScale: false };

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(-RANGE_LIMIT, Math.min(RANGE_LIMIT, value)) : fallback;
}

export function validRange(min: number, max: number, fallback: Range = DEFAULT_RANGE): Range {
  const low = finiteOr(min, fallback.min);
  const high = finiteOr(max, fallback.max);
  if (high - low > 1e-9) return { min: low, max: high };
  if (low - high > 1e-9) return { min: high, max: low };
  return { min: low - 1, max: low + 1 };
}

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function autoRange(values: number[]): Range {
  const finite = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (finite.length === 0) return DEFAULT_RANGE;
  let low = quantile(finite, 0.02);
  let high = quantile(finite, 0.98);
  if (high - low < 1e-9) return { min: low - 1, max: high + 1 };
  const span = high - low;
  if (low > 0 && low < span * 0.35) low = 0;
  if (high < 0 && -high < span * 0.35) high = 0;
  const pad = (high - low) * 0.06;
  return validRange(low - pad, high + pad);
}

export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

export function ticks(range: Range, target: number): { values: number[]; step: number } {
  const step = niceStep(range.max - range.min, target);
  const first = Math.ceil(range.min / step - 1e-9);
  const last = Math.floor(range.max / step + 1e-9);
  const values: number[] = [];
  for (let index = first; index <= last && values.length < 60; index += 1) values.push(index * step);
  return { values, step };
}

function decimalsOf(step: number): number {
  for (let decimals = 0; decimals < 6; decimals += 1) {
    const scaled = step * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled)) return decimals;
  }
  return 6;
}

export function tickLatex(value: number, step: number): string {
  const text = (Math.round(value / step) * step).toFixed(decimalsOf(step));
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

function clipSegment(a: Point, b: Point, x: Range, y: Range): [Point, Point] | null {
  let start = 0;
  let end = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: Array<[number, number]> = [
    [-dx, a.x - x.min],
    [dx, x.max - a.x],
    [-dy, a.y - y.min],
    [dy, y.max - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return null;
  }
  return [
    { x: a.x + dx * start, y: a.y + dy * start },
    { x: a.x + dx * end, y: a.y + dy * end },
  ];
}

export function curvePieces(fn: (x: number) => number, x: Range, y: Range, samples = SAMPLES): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [];
  const span = y.max - y.min;
  let previous: Point | null = null;
  const flush = () => {
    if (current.length > 1) pieces.push(current);
    current = [];
  };
  for (let index = 0; index <= samples; index += 1) {
    const px = x.min + ((x.max - x.min) * index) / samples;
    const py = fn(px);
    const point = { x: px, y: py };
    if (!Number.isFinite(py)) {
      flush();
      previous = null;
      continue;
    }
    if (previous) {
      const outside = (value: number) => value < y.min || value > y.max;
      const jump = Math.abs(py - previous.y) > span * 2 && (outside(py) || outside(previous.y)) && Math.sign(py - (y.min + y.max) / 2) !== Math.sign(previous.y - (y.min + y.max) / 2);
      if (jump) {
        flush();
      } else {
        const clipped = clipSegment(previous, point, x, y);
        if (!clipped) {
          flush();
        } else {
          const last = current[current.length - 1];
          if (!last || Math.abs(last.x - clipped[0].x) > 1e-9 || Math.abs(last.y - clipped[0].y) > 1e-9) {
            flush();
            current.push(clipped[0]);
          }
          current.push(clipped[1]);
        }
      }
    }
    previous = point;
  }
  flush();
  return pieces;
}

export function planGraph(settings: GraphSettings): GraphPlan {
  const x = validRange(settings.xMin, settings.xMax);
  const functions = settings.functions.slice(0, MAX_FUNCTIONS);
  const parsed = functions.map((item) => parseExpression(item.expression));
  const compiled = functions.flatMap((item, index) => {
    const result = parsed[index];
    return "expression" in result ? [{ index, color: item.color, fn: compile(result.expression), latex: toLatex(result.expression) }] : [];
  });

  let y = settings.autoY
    ? autoRange(compiled.flatMap(({ fn }) => Array.from({ length: 241 }, (_, step) => fn(x.min + ((x.max - x.min) * step) / 240))))
    : validRange(settings.yMin, settings.yMax);
  if (settings.equalScale) {
    const half = ((x.max - x.min) * PLOT_HEIGHT) / PLOT_WIDTH / 2;
    const middle = (y.min + y.max) / 2;
    const center = settings.autoY && y.max - y.min > half * 2 ? Math.min(y.max - half, Math.max(y.min + half, (x.min + x.max) / 2)) : middle;
    y = { min: center - half, max: center + half };
  }

  const sx = (value: number) => ((value - x.min) / (x.max - x.min)) * PLOT_WIDTH;
  const sy = (value: number) => PLOT_HEIGHT - ((value - y.min) / (y.max - y.min)) * PLOT_HEIGHT;
  const axisY = y.min <= 0 && y.max >= 0 ? sy(0) : y.min > 0 ? PLOT_HEIGHT : 0;
  const axisX = x.min <= 0 && x.max >= 0 ? sx(0) : x.min > 0 ? 0 : PLOT_WIDTH;
  const xTicks = ticks(x, 7);
  const yTicks = ticks(y, 6);
  const primitives: Primitive[] = [];

  if (settings.grid) {
    for (const value of xTicks.values) primitives.push({ type: "polyline", points: [{ x: sx(value), y: 0 }, { x: sx(value), y: PLOT_HEIGHT }], weight: 0.45, color: GRID_COLOR });
    for (const value of yTicks.values) primitives.push({ type: "polyline", points: [{ x: 0, y: sy(value) }, { x: PLOT_WIDTH, y: sy(value) }], weight: 0.45, color: GRID_COLOR });
  }

  primitives.push({ type: "arrow", from: { x: 0, y: axisY }, to: { x: PLOT_WIDTH + 12, y: axisY }, weight: 0.8 });
  primitives.push({ type: "arrow", from: { x: axisX, y: PLOT_HEIGHT }, to: { x: axisX, y: -12 }, weight: 0.8 });
  primitives.push({ type: "label", latex: "x", at: { x: PLOT_WIDTH + 15, y: axisY }, anchor: "w", scale: 0.9 });
  primitives.push({ type: "label", latex: "y", at: { x: axisX, y: -15 }, anchor: "s", scale: 0.9 });

  const originAtZero = x.min <= 0 && x.max >= 0 && y.min <= 0 && y.max >= 0;
  for (const value of xTicks.values) {
    const at = sx(value);
    if (Math.abs(value) < xTicks.step * 1e-6 && x.min <= 0 && x.max >= 0) continue;
    primitives.push({ type: "polyline", points: [{ x: at, y: axisY - 2.5 }, { x: at, y: axisY + 2.5 }], weight: 0.7 });
    primitives.push({ type: "label", latex: tickLatex(value, xTicks.step), at: { x: at, y: axisY + 4 }, anchor: "n", scale: TICK_SCALE });
  }
  for (const value of yTicks.values) {
    const at = sy(value);
    if (Math.abs(value) < yTicks.step * 1e-6 && y.min <= 0 && y.max >= 0) continue;
    primitives.push({ type: "polyline", points: [{ x: axisX - 2.5, y: at }, { x: axisX + 2.5, y: at }], weight: 0.7 });
    primitives.push({ type: "label", latex: tickLatex(value, yTicks.step), at: { x: axisX - 4, y: at }, anchor: "e", scale: TICK_SCALE });
  }
  if (originAtZero) primitives.push({ type: "label", latex: "0", at: { x: axisX - 3, y: axisY + 3 }, anchor: "ne", scale: TICK_SCALE });

  for (const { fn, color } of compiled) {
    for (const piece of curvePieces(fn, x, y)) primitives.push({ type: "polyline", points: piece.map((point) => ({ x: sx(point.x), y: sy(point.y) })), weight: 1.7, color });
  }

  if (settings.legend) {
    compiled.forEach(({ index, color, latex }, row) => {
      const top = PLOT_HEIGHT + 34 + row * 20;
      primitives.push({ type: "polyline", points: [{ x: 0, y: top }, { x: 16, y: top }], weight: 1.7, color });
      primitives.push({ type: "label", latex: `${LEGEND_NAMES[index]}(x) = ${latex}`, at: { x: 22, y: top }, anchor: "w", scale: 0.85, color });
    });
  }

  return { primitives, x, y, parsed };
}

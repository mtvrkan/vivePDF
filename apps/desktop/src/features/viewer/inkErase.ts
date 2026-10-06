import type { Rect } from "@embedpdf/models";

export type InkPoint = { x: number; y: number };
export type InkStroke = { points: InkPoint[] };

const lerp = (from: InkPoint, to: InkPoint, t: number): InkPoint => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });

function isInside(point: InkPoint, center: InkPoint, radius: number): boolean {
  return Math.hypot(point.x - center.x, point.y - center.y) <= radius;
}

function insideSpan(from: InkPoint, to: InkPoint, center: InkPoint, radius: number): [number, number] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fx = from.x - center.x;
  const fy = from.y - center.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return isInside(from, center, radius) ? [0, 1] : null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return null;
  const root = Math.sqrt(discriminant);
  const enter = Math.max(0, (-b - root) / (2 * a));
  const leave = Math.min(1, (-b + root) / (2 * a));
  return enter < leave ? [enter, leave] : null;
}

function eraseStroke(stroke: InkStroke, center: InkPoint, radius: number): InkStroke[] {
  const { points } = stroke;
  if (points.length === 0) return [];
  if (points.length === 1) return isInside(points[0], center, radius) ? [] : [stroke];
  const runs: InkStroke[] = [];
  let run: InkPoint[] = [];
  const flush = () => {
    if (run.length >= 2) runs.push({ points: run });
    run = [];
  };
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const span = insideSpan(from, to, center, radius);
    if (!span) {
      if (run.length === 0) run.push(from);
      run.push(to);
      continue;
    }
    const [enter, leave] = span;
    if (enter > 0) {
      if (run.length === 0) run.push(from);
      run.push(lerp(from, to, enter));
    }
    flush();
    if (leave < 1) run.push(lerp(from, to, leave), to);
  }
  flush();
  return runs;
}

export function eraseAt(strokes: InkStroke[], center: InkPoint, radius: number): InkStroke[] {
  return strokes.flatMap((stroke) => eraseStroke(stroke, center, radius));
}

export function eraseAlong(strokes: InkStroke[], path: InkPoint[], radius: number): InkStroke[] {
  if (path.length === 0) return strokes;
  const step = Math.max(radius / 2, 0.01);
  let result = eraseAt(strokes, path[0], radius);
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const samples = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
    for (let sample = 1; sample <= samples; sample += 1) result = eraseAt(result, lerp(from, to, sample / samples), radius);
  }
  return result;
}

export function sameStrokes(a: InkStroke[], b: InkStroke[]): boolean {
  return (
    a.length === b.length &&
    a.every((stroke, index) => stroke.points.length === b[index].points.length && stroke.points.every((point, at) => point.x === b[index].points[at].x && point.y === b[index].points[at].y))
  );
}

export function inkBounds(strokes: InkStroke[], strokeWidth: number): Rect | null {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (points.length === 0) return null;
  const pad = strokeWidth / 2;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs) - pad;
  const top = Math.min(...ys) - pad;
  return { origin: { x: left, y: top }, size: { width: Math.max(...xs) + pad - left, height: Math.max(...ys) + pad - top } };
}

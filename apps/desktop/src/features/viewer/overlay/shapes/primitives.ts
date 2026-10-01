export type Point = { x: number; y: number };
export type LineStyle = "solid" | "dashed";
export type Anchor = "center" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type Primitive =
  | { type: "polyline"; points: Point[]; closed?: boolean; line?: LineStyle | "none"; fill?: number | null; solid?: boolean; weight?: number; color?: string }
  | { type: "circle"; center: Point; radius: number; line?: LineStyle | "none"; fill?: number | null; solid?: boolean; weight?: number }
  | { type: "arrow"; from: Point; to: Point; weight?: number; both?: boolean }
  | { type: "dot"; center: Point; radius: number }
  | { type: "label"; latex: string; at: Point; anchor?: Anchor; scale?: number; color?: string };

export const DEG = Math.PI / 180;

export function point(x: number, y: number): Point {
  return { x, y };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Point, factor: number): Point {
  return { x: a.x * factor, y: a.y * factor };
}

export function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}

export function unit(a: Point): Point {
  const size = length(a);
  return size > 1e-9 ? scale(a, 1 / size) : { x: 0, y: 0 };
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function polar(center: Point, radius: number, degrees: number): Point {
  return { x: center.x + radius * Math.cos(degrees * DEG), y: center.y - radius * Math.sin(degrees * DEG) };
}

export function arcPoints(center: Point, radius: number, fromDegrees: number, toDegrees: number, steps = 32): Point[] {
  const count = Math.max(2, Math.ceil(steps * (Math.abs(toDegrees - fromDegrees) / 360)) + 1);
  return Array.from({ length: count }, (_, index) => polar(center, radius, fromDegrees + ((toDegrees - fromDegrees) * index) / (count - 1)));
}

export function centroid(points: Point[]): Point {
  const total = points.reduce((sum, item) => add(sum, item), { x: 0, y: 0 });
  return scale(total, 1 / Math.max(1, points.length));
}

export function outwardLabel(latex: string, at: Point, from: Point, distance = 9): Primitive {
  const direction = unit(sub(at, from));
  return { type: "label", latex, at: add(at, scale(direction, distance)) };
}

export function segmentLabel(latex: string, a: Point, b: Point, from: Point, distance = 9): Primitive {
  const middle = lerp(a, b, 0.5);
  const along = unit(sub(b, a));
  let normal = { x: -along.y, y: along.x };
  if (normal.x * (middle.x - from.x) + normal.y * (middle.y - from.y) < 0) normal = scale(normal, -1);
  return { type: "label", latex, at: add(middle, scale(normal, distance)) };
}

export function rightAngleMark(vertex: Point, towardA: Point, towardB: Point, size = 9): Primitive {
  const a = scale(unit(sub(towardA, vertex)), size);
  const b = scale(unit(sub(towardB, vertex)), size);
  return { type: "polyline", points: [add(vertex, a), add(add(vertex, a), b), add(vertex, b)], weight: 0.7 };
}

export function angleArc(vertex: Point, fromDegrees: number, toDegrees: number, radius: number, latex: string | null): Primitive[] {
  const arc: Primitive = { type: "polyline", points: arcPoints(vertex, radius, fromDegrees, toDegrees), weight: 0.8 };
  if (!latex) return [arc];
  return [arc, { type: "label", latex, at: polar(vertex, radius + 10, (fromDegrees + toDegrees) / 2) }];
}

export function hatch(from: Point, to: Point, side: 1 | -1, spacing = 8, depth = 7): Primitive[] {
  const along = sub(to, from);
  const size = length(along);
  const direction = unit(along);
  const normal = scale({ x: -direction.y, y: direction.x }, side);
  const ticks: Primitive[] = [{ type: "polyline", points: [from, to] }];
  const slant = add(scale(normal, depth), scale(direction, -depth * 0.8));
  for (let offset = spacing / 2; offset < size; offset += spacing) {
    const base = add(from, scale(direction, offset));
    ticks.push({ type: "polyline", points: [base, add(base, slant)], weight: 0.6 });
  }
  return ticks;
}

export function zigzag(from: Point, to: Point, teeth: number, amplitude: number, lead = 0): Point[] {
  const direction = unit(sub(to, from));
  const normal = { x: -direction.y, y: direction.x };
  const start = add(from, scale(direction, lead));
  const end = sub(to, scale(direction, lead));
  const span = length(sub(end, start));
  const points: Point[] = [from, start];
  const halfSteps = teeth * 2;
  for (let index = 1; index < halfSteps; index += 2) {
    const along = add(start, scale(direction, (span * index) / halfSteps));
    points.push(add(along, scale(normal, index % 4 === 1 ? amplitude : -amplitude)));
  }
  points.push(end, to);
  return points;
}

export function dashSegments(points: Point[], closed: boolean, dash: number, gap: number): Point[][] {
  const path = closed && points.length > 2 ? [...points, points[0]] : points;
  const segments: Point[][] = [];
  let drawing = true;
  let remaining = dash;
  let current: Point[] = path.length > 0 ? [path[0]] : [];
  for (let index = 1; index < path.length; index += 1) {
    let start = path[index - 1];
    const end = path[index];
    let span = length(sub(end, start));
    while (span > 1e-9) {
      const step = Math.min(span, remaining);
      const next = lerp(start, end, step / span);
      if (drawing) current.push(next);
      remaining -= step;
      span -= step;
      start = next;
      if (remaining <= 1e-9) {
        if (drawing && current.length > 1) segments.push(current);
        drawing = !drawing;
        remaining = drawing ? dash : gap;
        current = drawing ? [start] : [];
      }
    }
  }
  if (drawing && current.length > 1) segments.push(current);
  return segments;
}

export function isFinitePrimitive(primitive: Primitive): boolean {
  const finite = (item: Point) => Number.isFinite(item.x) && Number.isFinite(item.y);
  switch (primitive.type) {
    case "polyline":
      return primitive.points.length > 0 && primitive.points.every(finite);
    case "circle":
    case "dot":
      return finite(primitive.center) && Number.isFinite(primitive.radius);
    case "arrow":
      return finite(primitive.from) && finite(primitive.to);
    case "label":
      return finite(primitive.at);
  }
}

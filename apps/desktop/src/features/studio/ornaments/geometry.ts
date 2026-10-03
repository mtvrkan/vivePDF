import { num } from "../model/shapes";

export type Point = [number, number];

export type Segment = { op: "M" | "L" | "C" | "Z"; points: Point[] };

const KAPPA = 0.5522847498;

export function toD(segments: Segment[]): string {
  return segments.map((segment) => (segment.op === "Z" ? "Z" : `${segment.op}${segment.points.map(([x, y]) => `${num(x)} ${num(y)}`).join(" ")}`)).join(" ");
}

export function mapPoints(segments: Segment[], map: (point: Point) => Point): Segment[] {
  return segments.map((segment) => ({ op: segment.op, points: segment.points.map(map) }));
}

export function polyline(points: Point[], closed = false): Segment[] {
  const segments: Segment[] = points.map((point, index) => ({ op: index ? "L" : "M", points: [point] }));
  return closed ? [...segments, { op: "Z", points: [] }] : segments;
}

export function smooth(points: Point[], closed = false, tension = 1): Segment[] {
  if (points.length < 3) return polyline(points, closed);
  const count = points.length;
  const at = (index: number): Point => (closed ? points[(index + count) % count] : points[Math.max(0, Math.min(count - 1, index))]);
  const segments: Segment[] = [{ op: "M", points: [points[0]] }];
  const last = closed ? count : count - 1;
  for (let index = 0; index < last; index += 1) {
    const [p0, p1, p2, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
    const c1: Point = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: Point = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    segments.push({ op: "C", points: [c1, c2, p2] });
  }
  return closed ? [...segments, { op: "Z", points: [] }] : segments;
}

export function circle(cx: number, cy: number, r: number): Segment[] {
  const k = r * KAPPA;
  return [
    { op: "M", points: [[cx + r, cy]] },
    { op: "C", points: [[cx + r, cy + k], [cx + k, cy + r], [cx, cy + r]] },
    { op: "C", points: [[cx - k, cy + r], [cx - r, cy + k], [cx - r, cy]] },
    { op: "C", points: [[cx - r, cy - k], [cx - k, cy - r], [cx, cy - r]] },
    { op: "C", points: [[cx + k, cy - r], [cx + r, cy - k], [cx + r, cy]] },
    { op: "Z", points: [] },
  ];
}

export function polar(cx: number, cy: number, r: number, angle: number): Point {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

export function rotateAround([cx, cy]: Point, angle: number): (point: Point) => Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

export function sampled(count: number, at: (t: number) => Point, closed = true): Segment[] {
  const points = Array.from({ length: closed ? count : count + 1 }, (_, index) => at(index / count));
  return polyline(points, closed);
}

export function arc(cx: number, cy: number, r: number, from: number, to: number): Segment[] {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2)));
  const step = (to - from) / steps;
  const handle = (4 / 3) * Math.tan(step / 4) * r;
  const segments: Segment[] = [{ op: "M", points: [polar(cx, cy, r, from)] }];
  for (let index = 0; index < steps; index += 1) {
    const a = from + step * index;
    const b = a + step;
    const start = polar(cx, cy, r, a);
    const end = polar(cx, cy, r, b);
    segments.push({
      op: "C",
      points: [
        [start[0] - handle * Math.sin(a), start[1] + handle * Math.cos(a)],
        [end[0] + handle * Math.sin(b), end[1] - handle * Math.cos(b)],
        end,
      ],
    });
  }
  return segments;
}

export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function roundedRectangleAt(x: number, y: number, width: number, height: number, radius: number): (s: number) => { point: Point; normal: Point } {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const straightX = width - 2 * r;
  const straightY = height - 2 * r;
  const quarter = (Math.PI / 2) * r;
  const lengths = [straightX, quarter, straightY, quarter, straightX, quarter, straightY, quarter];
  const total = lengths.reduce((sum, value) => sum + value, 0);
  return (s: number) => {
    let rest = (((s % 1) + 1) % 1) * total;
    let part = 0;
    while (part < lengths.length - 1 && rest > lengths[part]) {
      rest -= lengths[part];
      part += 1;
    }
    const corner = (cx: number, cy: number, start: number) => {
      const angle = start + (r ? rest / r : 0);
      return { point: polar(cx, cy, r, angle), normal: [-Math.cos(angle), -Math.sin(angle)] as Point };
    };
    switch (part) {
      case 0:
        return { point: [x + r + rest, y], normal: [0, 1] };
      case 1:
        return corner(x + width - r, y + r, -Math.PI / 2);
      case 2:
        return { point: [x + width, y + r + rest], normal: [-1, 0] };
      case 3:
        return corner(x + width - r, y + height - r, 0);
      case 4:
        return { point: [x + width - r - rest, y + height], normal: [0, -1] };
      case 5:
        return corner(x + r, y + height - r, Math.PI / 2);
      case 6:
        return { point: [x, y + height - r - rest], normal: [1, 0] };
      default:
        return corner(x + r, y + r, Math.PI);
    }
  };
}

export function perimeter(width: number, height: number, radius: number): number {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return 2 * (width - 2 * r) + 2 * (height - 2 * r) + 2 * Math.PI * r;
}

import { add, angleArc, centroid, DEG, outwardLabel, point, polar, rightAngleMark, scale, segmentLabel, sub, unit, type Point, type Primitive } from "./primitives";

function polygon(points: Point[], vertexLabels: string[] = [], sideLabels: Array<string | null> = []): Primitive[] {
  const middle = centroid(points);
  const result: Primitive[] = [{ type: "polyline", points, closed: true, fill: 1 }];
  vertexLabels.forEach((latex, index) => result.push(outwardLabel(latex, points[index], middle, 9)));
  sideLabels.forEach((latex, index) => {
    if (latex) result.push(segmentLabel(latex, points[index], points[(index + 1) % points.length], middle, 9));
  });
  return result;
}

export function triangle(): Primitive[] {
  const [a, b, c] = [point(0, 110), point(150, 110), point(55, 0)];
  return polygon([a, b, c], ["A", "B", "C"], ["c", "a", "b"]);
}

export function rightTriangle(): Primitive[] {
  const [a, b, c] = [point(0, 0), point(0, 100), point(150, 100)];
  return [...polygon([a, b, c], ["A", "B", "C"], ["c", "a", "b"]), rightAngleMark(b, a, c, 10)];
}

export function rectangle(width: number, height: number): Primitive[] {
  const points = [point(0, 0), point(width, 0), point(width, height), point(0, height)];
  return [...polygon(points, ["A", "B", "C", "D"], [null, "b", "a", null]), ...points.map((corner, index) => rightAngleMark(corner, points[(index + 1) % 4], points[(index + 3) % 4], 7))];
}

export function square(side: number): Primitive[] {
  const points = [point(0, 0), point(side, 0), point(side, side), point(0, side)];
  return [...polygon(points, ["A", "B", "C", "D"], [null, null, "a", null]), ...points.map((corner, index) => rightAngleMark(corner, points[(index + 1) % 4], points[(index + 3) % 4], 7))];
}

export function parallelogram(): Primitive[] {
  return polygon([point(35, 0), point(185, 0), point(150, 90), point(0, 90)], ["A", "B", "C", "D"]);
}

export function trapezoid(): Primitive[] {
  return polygon([point(45, 0), point(135, 0), point(180, 90), point(0, 90)], ["A", "B", "C", "D"]);
}

export function regularPolygon(sides: number, radius: number): Primitive[] {
  const count = Math.round(Math.min(12, Math.max(3, sides)));
  const start = 90 + 180 / count;
  const points = Array.from({ length: count }, (_, index) => polar(point(0, 0), radius, start + (360 * index) / count));
  const bottom = points.reduce((best, item, index) => (item.y + points[(index + 1) % count].y > points[best].y + points[(best + 1) % count].y ? index : best), 0);
  return polygon(points, [], points.map((_, index) => (index === bottom ? "a" : null)));
}

export function circle(radius: number): Primitive[] {
  const centre = point(0, 0);
  const edge = polar(centre, radius, 20);
  return [{ type: "circle", center: centre, radius, fill: 1 }, { type: "dot", center: centre, radius: 1.6 }, { type: "polyline", points: [centre, edge], weight: 0.8 }, segmentLabel("r", centre, edge, point(0, radius), 7), { type: "label", latex: "O", at: point(-2, 10) }];
}

export function angle(degrees: number): Primitive[] {
  const value = Math.min(175, Math.max(5, degrees));
  const vertex = point(0, 0);
  const length = 130;
  const first = polar(vertex, length, 0);
  const second = polar(vertex, length, value);
  return [{ type: "polyline", points: [second, vertex, first] }, ...angleArc(vertex, 0, value, 28, "\\theta"), { type: "label", latex: "O", at: point(-8, 8) }];
}

export function parallelLines(): Primitive[] {
  const tilt = 62;
  const crossBottom = point(60, 80);
  const crossTop = point(60 + 80 / Math.tan(tilt * DEG), 0);
  const direction = unit(sub(crossTop, crossBottom));
  const start = sub(crossBottom, scale(direction, 40));
  const end = add(crossTop, scale(direction, 40));
  return [
    { type: "arrow", from: point(-10, 0), to: point(190, 0), both: true, weight: 1 },
    { type: "arrow", from: point(-10, 80), to: point(190, 80), both: true, weight: 1 },
    { type: "polyline", points: [start, end] },
    ...angleArc(crossTop, 0, tilt, 16, "\\alpha"),
    ...angleArc(crossBottom, 0, tilt, 16, "\\beta"),
    { type: "label", latex: "d_1", at: point(205, 0) },
    { type: "label", latex: "d_2", at: point(205, 80) },
  ];
}

export function axes(range: number, grid: boolean): Primitive[] {
  const count = Math.round(Math.min(10, Math.max(1, range)));
  const step = 16;
  const extent = count * step + 14;
  const result: Primitive[] = [];
  if (grid) {
    for (let index = -count; index <= count; index += 1) {
      if (index === 0) continue;
      result.push({ type: "polyline", points: [point(index * step, -count * step), point(index * step, count * step)], line: "dashed", weight: 0.4 });
      result.push({ type: "polyline", points: [point(-count * step, index * step), point(count * step, index * step)], line: "dashed", weight: 0.4 });
    }
  }
  result.push({ type: "arrow", from: point(-extent, 0), to: point(extent, 0), weight: 0.9 }, { type: "arrow", from: point(0, extent), to: point(0, -extent), weight: 0.9 });
  for (let index = -count; index <= count; index += 1) {
    if (index === 0) continue;
    result.push({ type: "polyline", points: [point(index * step, -3), point(index * step, 3)], weight: 0.7 }, { type: "polyline", points: [point(-3, index * step), point(3, index * step)], weight: 0.7 });
  }
  result.push({ type: "label", latex: "x", at: point(extent + 4, 8), anchor: "w" }, { type: "label", latex: "y", at: point(8, -extent - 4), anchor: "sw" }, { type: "label", latex: "O", at: point(-8, 9) });
  if (count >= 1) result.push({ type: "label", latex: "1", at: point(step, 11), scale: 0.8 }, { type: "label", latex: "1", at: point(-10, -step), scale: 0.8 });
  return result;
}

export function numberLine(range: number): Primitive[] {
  const count = Math.round(Math.min(10, Math.max(1, range)));
  const step = 22;
  const result: Primitive[] = [{ type: "arrow", from: point(-count * step - 16, 0), to: point(count * step + 16, 0), both: true, weight: 0.9 }];
  for (let index = -count; index <= count; index += 1) {
    result.push({ type: "polyline", points: [point(index * step, -5), point(index * step, 5)], weight: 0.8 });
    result.push({ type: "label", latex: String(index), at: point(index * step, 9), anchor: "n", scale: 0.85 });
  }
  return result;
}

export function vector(lengthValue: number, degrees: number): Primitive[] {
  const tail = point(0, 0);
  const head = polar(tail, Math.max(20, lengthValue), degrees);
  return [{ type: "arrow", from: tail, to: head, weight: 1.2 }, { type: "dot", center: tail, radius: 1.6 }, segmentLabel("\\vec{F}", tail, head, point(head.x, head.y + 60), 10)];
}

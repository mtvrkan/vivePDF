import { add, angleArc, arcPoints, hatch, lerp, point, polar, rightAngleMark, scale, segmentLabel, sub, unit, zigzag, type Point, type Primitive } from "./primitives";

function block(centerBase: Point, along: Point, normal: Point, width: number, height: number): Point[] {
  const half = scale(along, width / 2);
  const up = scale(normal, height);
  return [sub(centerBase, half), add(centerBase, half), add(add(centerBase, half), up), add(sub(centerBase, half), up)];
}

export function incline(degrees: number, forces: boolean): Primitive[] {
  const theta = Math.min(60, Math.max(10, degrees));
  const base = 190;
  const rise = base * Math.tan((theta * Math.PI) / 180);
  const bottomLeft = point(0, rise);
  const bottomRight = point(base, rise);
  const top = point(base, 0);
  const along = unit(sub(top, bottomLeft));
  const normal = { x: along.y, y: -along.x };
  const contact = lerp(bottomLeft, top, 0.55);
  const corners = block(contact, along, normal, 38, 26);
  const result: Primitive[] = [
    { type: "polyline", points: [bottomLeft, bottomRight, top], closed: true, fill: 1 },
    ...hatch(point(-10, rise), point(base + 10, rise), 1),
    rightAngleMark(bottomRight, bottomLeft, top, 8),
    ...angleArc(bottomLeft, 0, theta, 30, "\\theta"),
    { type: "polyline", points: corners, closed: true, fill: 0.8 },
  ];
  if (forces) {
    const middle = add(contact, scale(normal, 13));
    const weightEnd = add(middle, point(0, 55));
    const normalEnd = add(middle, scale(normal, 50));
    const frictionStart = add(contact, scale(along, 19));
    const frictionEnd = add(frictionStart, scale(along, 40));
    result.push(
      { type: "arrow", from: middle, to: weightEnd, weight: 1.1 },
      { type: "label", latex: "mg", at: add(weightEnd, point(10, 4)), anchor: "w" },
      { type: "arrow", from: middle, to: normalEnd, weight: 1.1 },
      { type: "label", latex: "N", at: add(normalEnd, scale(normal, 9)) },
      { type: "arrow", from: frictionStart, to: frictionEnd, weight: 1.1 },
      segmentLabel("f", frictionStart, frictionEnd, add(frictionStart, scale(normal, -30)), 9),
    );
  }
  return result;
}

export function spring(coils: number): Primitive[] {
  const turns = Math.round(Math.min(16, Math.max(3, coils)));
  const floor = 60;
  return [
    ...hatch(point(0, -10), point(0, floor), 1),
    ...hatch(point(0, floor), point(230, floor), 1),
    { type: "polyline", points: zigzag(point(0, 40), point(170, 40), turns, 8, 10) },
    { type: "polyline", points: [point(170, 20), point(210, 20), point(210, floor), point(170, floor)], closed: true, fill: 0.8 },
    { type: "label", latex: "k", at: point(85, 22) },
    { type: "label", latex: "m", at: point(190, 40) },
  ];
}

export function pendulum(degrees: number): Primitive[] {
  const theta = Math.min(70, Math.max(5, degrees));
  const pivot = point(0, 0);
  const lengthValue = 140;
  const bob = polar(pivot, lengthValue, -90 + theta);
  return [
    ...hatch(point(-60, 0), point(60, 0), -1),
    { type: "polyline", points: [pivot, point(0, lengthValue + 10)], line: "dashed", weight: 0.6 },
    { type: "polyline", points: [pivot, bob] },
    { type: "circle", center: bob, radius: 12, fill: 0.8 },
    { type: "dot", center: pivot, radius: 2 },
    ...angleArc(pivot, -90, -90 + theta, 38, "\\theta"),
    segmentLabel("L", pivot, bob, point(-40, 60), 9),
    { type: "label", latex: "m", at: add(bob, point(20, 4)), anchor: "w" },
  ];
}

export function pulley(): Primitive[] {
  const centre = point(0, 45);
  const radius = 22;
  const left = point(-radius, 45);
  const right = point(radius, 45);
  return [
    ...hatch(point(-45, 0), point(45, 0), -1),
    { type: "polyline", points: [point(0, 0), centre], weight: 1.2 },
    { type: "circle", center: centre, radius, fill: 0.9 },
    { type: "dot", center: centre, radius: 2.2 },
    { type: "polyline", points: arcPoints(centre, radius, 0, 180, 48) },
    { type: "polyline", points: [left, point(-radius, 150)] },
    { type: "polyline", points: [right, point(radius, 115)] },
    { type: "polyline", points: [point(-radius - 17, 150), point(-radius + 17, 150), point(-radius + 17, 184), point(-radius - 17, 184)], closed: true, fill: 0.8 },
    { type: "polyline", points: [point(radius - 15, 115), point(radius + 15, 115), point(radius + 15, 145), point(radius - 15, 145)], closed: true, fill: 0.8 },
    { type: "label", latex: "m_1", at: point(-radius, 167) },
    { type: "label", latex: "m_2", at: point(radius, 130) },
  ];
}

function leads(length: number, gap: number): Primitive[] {
  const start = (length - gap) / 2;
  return [{ type: "polyline", points: [point(0, 0), point(start, 0)] }, { type: "polyline", points: [point(start + gap, 0), point(length, 0)] }];
}

export function resistor(): Primitive[] {
  return [{ type: "polyline", points: zigzag(point(0, 0), point(110, 0), 6, 8, 25) }, { type: "label", latex: "R", at: point(55, -18) }];
}

export function cell(): Primitive[] {
  return [
    ...leads(110, 14),
    { type: "polyline", points: [point(48, -18), point(48, 18)] },
    { type: "polyline", points: [point(62, -9), point(62, 9)], weight: 2.4 },
    { type: "label", latex: "+", at: point(40, -18), scale: 0.9 },
    { type: "label", latex: "-", at: point(70, -18), scale: 0.9 },
    { type: "label", latex: "\\varepsilon", at: point(55, 26) },
  ];
}

export function capacitor(): Primitive[] {
  return [...leads(110, 12), { type: "polyline", points: [point(49, -16), point(49, 16)], weight: 1.6 }, { type: "polyline", points: [point(61, -16), point(61, 16)], weight: 1.6 }, { type: "label", latex: "C", at: point(55, -26) }];
}

export function lamp(): Primitive[] {
  const centre = point(55, 0);
  const radius = 15;
  return [...leads(110, radius * 2), { type: "circle", center: centre, radius, fill: 1 }, { type: "polyline", points: [polar(centre, radius, 135), polar(centre, radius, -45)] }, { type: "polyline", points: [polar(centre, radius, 45), polar(centre, radius, 225)] }];
}

export function switchOpen(): Primitive[] {
  return [
    { type: "polyline", points: [point(0, 0), point(38, 0)] },
    { type: "dot", center: point(40, 0), radius: 2.4 },
    { type: "polyline", points: [point(40, 0), polar(point(40, 0), 34, 28)] },
    { type: "dot", center: point(72, 0), radius: 2.4 },
    { type: "polyline", points: [point(74, 0), point(110, 0)] },
    { type: "label", latex: "S", at: point(56, 14) },
  ];
}

export function meter(letter: "A" | "V"): Primitive[] {
  const centre = point(55, 0);
  return [...leads(110, 32), { type: "circle", center: centre, radius: 16, fill: 1 }, { type: "label", latex: `\\mathrm{${letter}}`, at: centre }];
}

export function simpleCircuit(): Primitive[] {
  const [width, height] = [200, 130];
  const cellPlates: Primitive[] = [
    { type: "polyline", points: [point(-14, height / 2 - 7), point(14, height / 2 - 7)] },
    { type: "polyline", points: [point(-7, height / 2 + 5), point(7, height / 2 + 5)], weight: 2.4 },
  ];
  const lampCentre = point(width, height / 2);
  return [
    { type: "polyline", points: [point(0, height / 2 - 7), point(0, 0), point(60, 0)] },
    { type: "polyline", points: zigzag(point(60, 0), point(140, 0), 5, 7, 8) },
    { type: "polyline", points: [point(140, 0), point(width, 0), point(width, height / 2 - 14)] },
    { type: "circle", center: lampCentre, radius: 14, fill: 1 },
    { type: "polyline", points: [polar(lampCentre, 14, 135), polar(lampCentre, 14, -45)] },
    { type: "polyline", points: [polar(lampCentre, 14, 45), polar(lampCentre, 14, 225)] },
    { type: "polyline", points: [point(width, height / 2 + 14), point(width, height), point(125, height)] },
    { type: "dot", center: point(123, height), radius: 2.2 },
    { type: "polyline", points: [point(123, height), polar(point(123, height), 30, 150)] },
    { type: "dot", center: point(92, height), radius: 2.2 },
    { type: "polyline", points: [point(90, height), point(0, height), point(0, height / 2 + 5)] },
    ...cellPlates,
    { type: "label", latex: "R", at: point(100, -16) },
    { type: "label", latex: "L", at: point(width + 24, height / 2) },
    { type: "label", latex: "S", at: point(108, height + 14) },
    { type: "label", latex: "\\varepsilon", at: point(-26, height / 2) },
  ];
}

export function lens(kind: "convex" | "concave"): Primitive[] {
  const half = 70;
  const bulge = 14;
  const axis: Primitive = { type: "polyline", points: [point(-150, 0), point(150, 0)], weight: 0.7 };
  const outline: Point[] =
    kind === "convex"
      ? [...arcSide(point(0, -half), point(0, half), bulge), ...arcSide(point(0, half), point(0, -half), bulge)]
      : [point(-bulge, -half), point(bulge, -half), ...arcSide(point(bulge, -half), point(bulge, half), bulge * 0.8), point(-bulge, half), ...arcSide(point(-bulge, half), point(-bulge, -half), bulge * 0.8)];
  const marks: Primitive[] = [];
  for (const [x, latex] of [[-120, "2F"], [-60, "F"], [60, "F'"], [120, "2F'"]] as const) {
    marks.push({ type: "dot", center: point(x, 0), radius: 2 }, { type: "label", latex: latex.replace("'", "^{\\prime}"), at: point(x, 12), anchor: "n", scale: 0.9 });
  }
  return [axis, { type: "polyline", points: outline, closed: true, fill: 0.9 }, ...marks, { type: "label", latex: "O", at: point(8, -10) }];
}

function arcSide(from: Point, to: Point, bulge: number, steps = 48): Point[] {
  const middle = lerp(from, to, 0.5);
  const direction = unit(sub(to, from));
  const peak = add(middle, scale({ x: -direction.y, y: direction.x }, bulge));
  const d = 2 * (from.x * (peak.y - to.y) + peak.x * (to.y - from.y) + to.x * (from.y - peak.y));
  if (Math.abs(d) < 1e-9) return [from, to];
  const squared = (item: Point) => item.x * item.x + item.y * item.y;
  const centre = {
    x: (squared(from) * (peak.y - to.y) + squared(peak) * (to.y - from.y) + squared(to) * (from.y - peak.y)) / d,
    y: (squared(from) * (to.x - peak.x) + squared(peak) * (from.x - to.x) + squared(to) * (peak.x - from.x)) / d,
  };
  const radius = Math.hypot(from.x - centre.x, from.y - centre.y);
  const angleOf = (item: Point) => Math.atan2(item.y - centre.y, item.x - centre.x);
  const turn = (a: number, b: number) => (((b - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const start = angleOf(from);
  const toEnd = turn(start, angleOf(to));
  const sweep = turn(start, angleOf(peak)) <= toEnd ? toEnd : toEnd - Math.PI * 2;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + (sweep * index) / steps;
    return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
  });
}

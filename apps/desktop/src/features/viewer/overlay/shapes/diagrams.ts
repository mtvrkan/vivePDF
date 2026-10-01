import { add, arcPoints, lerp, point, polar, scale, sub, unit, type Point, type Primitive } from "./primitives";

const TREE_LEVEL_GAP = 120;
const TREE_LEAF_GAPS = { 2: 26, 3: 34 } as const;
const TREE_NODE_CLEARANCE = 16;
const TREE_LABEL_SCALE = 0.85;
const TREE_LABEL_AT = 0.62;
const TREE_LABEL_OFFSET = 7;
const TWO_WAY = ["p", "q", "r"];
const EVENTS = ["A", "B", "C"];

function frame(left: number, top: number, right: number, bottom: number): Primitive[] {
  return [
    { type: "polyline", points: [point(left, top), point(right, top), point(right, bottom), point(left, bottom)], closed: true },
    { type: "label", latex: "U", at: point(left + 6, top + 5), anchor: "nw" },
  ];
}

export function venn2(universe: boolean): Primitive[] {
  const radius = 60;
  const a = point(-35, 0);
  const b = point(35, 0);
  return [
    ...(universe ? frame(-118, -82, 118, 82) : []),
    { type: "circle", center: a, radius, fill: 1, solid: true },
    { type: "circle", center: b, radius, fill: 1, solid: true },
    { type: "label", latex: "A", at: polar(a, radius + 10, 135) },
    { type: "label", latex: "B", at: polar(b, radius + 10, 45) },
  ];
}

export function venn3(universe: boolean): Primitive[] {
  const radius = 55;
  const a = point(-32, -18);
  const b = point(32, -18);
  const c = point(0, 37);
  return [
    ...(universe ? frame(-112, -98, 112, 118) : []),
    { type: "circle", center: a, radius, fill: 1, solid: true },
    { type: "circle", center: b, radius, fill: 1, solid: true },
    { type: "circle", center: c, radius, fill: 1, solid: true },
    { type: "label", latex: "A", at: polar(a, radius + 10, 150) },
    { type: "label", latex: "B", at: polar(b, radius + 10, 30) },
    { type: "label", latex: "C", at: polar(c, radius + 11, 270) },
  ];
}

function branchLabels(level: number, branches: number): { chance: string[]; outcome: string[] } {
  const event = EVENTS[level];
  if (branches === 2) {
    const symbol = TWO_WAY[level];
    return { chance: [symbol, `1-${symbol}`], outcome: [event, `\\bar{${event}}`] };
  }
  const symbol = TWO_WAY[level];
  return {
    chance: Array.from({ length: branches }, (_, index) => `${symbol}_${index + 1}`),
    outcome: Array.from({ length: branches }, (_, index) => `${event}_${index + 1}`),
  };
}

function branchLabel(latex: string, from: Point, to: Point, above: boolean): Primitive {
  const along = unit(sub(to, from));
  const normal = scale(point(along.y, -along.x), above ? 1 : -1);
  return { type: "label", latex, at: add(lerp(from, to, TREE_LABEL_AT), scale(normal, TREE_LABEL_OFFSET)), scale: TREE_LABEL_SCALE };
}

export function probabilityTree(levels: number, branches: number): Primitive[] {
  const depth = Math.round(Math.min(3, Math.max(1, levels)));
  const ways = Math.round(Math.min(3, Math.max(2, branches))) as 2 | 3;
  const leafGap = TREE_LEAF_GAPS[ways];
  const result: Primitive[] = [];
  let leaf = 0;

  const place = (level: number): number => {
    if (level === depth) {
      const y = leaf * leafGap;
      leaf += 1;
      return y;
    }
    const children = Array.from({ length: ways }, () => place(level + 1));
    const y = children.reduce((sum, value) => sum + value, 0) / children.length;
    const labels = branchLabels(level, ways);
    const from = point(level * TREE_LEVEL_GAP + (level === 0 ? 3 : TREE_NODE_CLEARANCE), y);
    children.forEach((childY, index) => {
      const to = point((level + 1) * TREE_LEVEL_GAP - TREE_NODE_CLEARANCE, childY);
      result.push({ type: "polyline", points: [from, to] });
      result.push(branchLabel(labels.chance[index], from, to, childY <= y));
      result.push({ type: "label", latex: labels.outcome[index], at: point((level + 1) * TREE_LEVEL_GAP, childY) });
    });
    return y;
  };

  const rootY = place(0);
  result.unshift({ type: "dot", center: point(0, rootY), radius: 2.5 });
  return result;
}

function fractionOf(numerator: number, denominator: number): { shaded: number; parts: number } {
  const parts = Math.round(Math.min(16, Math.max(2, denominator)));
  return { parts, shaded: Math.round(Math.min(parts, Math.max(0, numerator))) };
}

export function fractionCircle(numerator: number, denominator: number, showFraction: boolean): Primitive[] {
  const { parts, shaded } = fractionOf(numerator, denominator);
  const radius = 70;
  const centre = point(0, 0);
  const result: Primitive[] = Array.from({ length: parts }, (_, index) => {
    const start = 90 - (360 * index) / parts;
    const end = 90 - (360 * (index + 1)) / parts;
    return { type: "polyline", points: [centre, ...arcPoints(centre, radius, start, end, 96)], closed: true, fill: index < shaded ? 1 : null, solid: true, weight: 0.8 } satisfies Primitive;
  });
  result.push({ type: "circle", center: centre, radius });
  if (showFraction) result.push({ type: "label", latex: `\\frac{${shaded}}{${parts}}`, at: point(radius + 34, 0), scale: 1.5 });
  return result;
}

export function fractionBar(numerator: number, denominator: number, showFraction: boolean): Primitive[] {
  const { parts, shaded } = fractionOf(numerator, denominator);
  const width = 240;
  const height = 36;
  const step = width / parts;
  const result: Primitive[] = Array.from({ length: parts }, (_, index) => ({
    type: "polyline",
    points: [point(index * step, 0), point((index + 1) * step, 0), point((index + 1) * step, height), point(index * step, height)],
    closed: true,
    fill: index < shaded ? 1 : null,
    solid: true,
    weight: 0.8,
  }));
  result.push({ type: "polyline", points: [point(0, 0), point(width, 0), point(width, height), point(0, height)], closed: true });
  if (showFraction) result.push({ type: "label", latex: `\\frac{${shaded}}{${parts}}`, at: point(width + 30, height / 2), scale: 1.5 });
  return result;
}

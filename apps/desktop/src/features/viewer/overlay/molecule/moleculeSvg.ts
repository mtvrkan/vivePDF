export type MoleculeArt = { svg: string; width: number; height: number };

type Point = { x: number; y: number };
type Circle = Point & { r: number };
type Segment = { a: Point; b: Point; width: number };
type Glyph = { x: number; y: number; text: string; size: number; color: string };
type Box = { x0: number; y0: number; x1: number; y1: number };
type Script = "base" | "sub" | "sup";
type Run = { text: string; script: Script };
type Direction = "left" | "right" | "up" | "down";
type Label = Point & { direction: Direction; parts: { text: string; color: string }[] };

export const LABEL_FONT_SIZE = 44 / 3;
export const LABEL_FONT_FAMILY = "Helvetica, Arial, sans-serif";

const SCRIPT_SCALE = 0.7;
const SUB_SHIFT = 0.25;
const SUP_SHIFT = -0.42;
const BASELINE = 0.36;
const LINE_STEP = 0.9;
const ASCENT = 0.75;
const DESCENT = 0.22;
const PADDING = 2;
const MIN_PIECE = 0.05;
const DEFAULT_DASH = [5, 5];

const WIDTH_GROUPS: readonly [number, string][] = [
  [222, "ijl"],
  [278, "Ift"],
  [333, "r-()"],
  [389, "*"],
  [500, "Jcksvxyz"],
  [556, "Labdeghnopqu0123456789#"],
  [584, "+−"],
  [611, "FTZ"],
  [667, "ABEKPSVXY"],
  [722, "CDHNRUw"],
  [778, "GOQ"],
  [833, "Mm"],
  [944, "W"],
];
const FALLBACK_WIDTH = 556;
const ADVANCES = new Map(WIDTH_GROUPS.flatMap(([width, chars]) => [...chars].map((char) => [char, width] as const)));

const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "−" };
const SUBSCRIPTS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

export function textAdvance(text: string, size: number): number {
  let total = 0;
  for (const char of text) total += ADVANCES.get(char) ?? FALLBACK_WIDTH;
  return (total * size) / 1000;
}

export function scriptRuns(text: string): Run[] {
  const runs: Run[] = [];
  for (const char of text) {
    const script: Script = char in SUPERSCRIPTS ? "sup" : char in SUBSCRIPTS ? "sub" : "base";
    const plain = SUPERSCRIPTS[char] ?? SUBSCRIPTS[char] ?? char;
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += plain;
    else runs.push({ text: plain, script });
  }
  return runs;
}

function runSize(run: Run): number {
  return run.script === "base" ? LABEL_FONT_SIZE : LABEL_FONT_SIZE * SCRIPT_SCALE;
}

function runsWidth(runs: readonly Run[]): number {
  return runs.reduce((sum, run) => sum + textAdvance(run.text, runSize(run)), 0);
}

function placeRuns(runs: readonly Run[], x: number, baseline: number, color: string): Glyph[] {
  const glyphs: Glyph[] = [];
  let cursor = x;
  for (const run of runs) {
    const size = runSize(run);
    const shift = run.script === "sub" ? SUB_SHIFT : run.script === "sup" ? SUP_SHIFT : 0;
    glyphs.push({ x: cursor, y: baseline + shift * LABEL_FONT_SIZE, text: run.text, size, color });
    cursor += textAdvance(run.text, size);
  }
  return glyphs;
}

export function layoutLabel(label: Label): Glyph[] {
  const parts = label.parts.map((part) => ({ runs: scriptRuns(part.text), color: part.color }));
  if (parts.length === 0) return [];
  const anchorIndex = label.direction === "left" ? parts.length - 1 : 0;
  const anchorRuns = parts[anchorIndex].runs;
  const lead = anchorRuns[0]?.script === "sup" ? runsWidth([anchorRuns[0]]) : 0;
  const symbol = anchorRuns.find((run) => run.script === "base");
  const symbolWidth = symbol ? textAdvance(symbol.text, LABEL_FONT_SIZE) : runsWidth(anchorRuns);
  const symbolStart = label.x - symbolWidth / 2;
  const baseline = label.y + BASELINE * LABEL_FONT_SIZE;

  if (label.direction === "up" || label.direction === "down") {
    const step = (label.direction === "up" ? -1 : 1) * LINE_STEP * LABEL_FONT_SIZE;
    return parts.flatMap((part, index) => placeRuns(part.runs, index === 0 ? symbolStart - lead : symbolStart, baseline + step * index, part.color));
  }

  const starts: number[] = [];
  starts[anchorIndex] = symbolStart - lead;
  for (let index = anchorIndex + 1; index < parts.length; index += 1) starts[index] = starts[index - 1] + runsWidth(parts[index - 1].runs);
  for (let index = anchorIndex - 1; index >= 0; index -= 1) starts[index] = starts[index + 1] - runsWidth(parts[index].runs);
  return parts.flatMap((part, index) => placeRuns(part.runs, starts[index], baseline, part.color));
}

function subtractInterval(intervals: [number, number][], cut: [number, number]): [number, number][] {
  return intervals.flatMap(([start, end]): [number, number][] => {
    if (cut[1] <= start || cut[0] >= end) return [[start, end]];
    const kept: [number, number][] = [];
    if (cut[0] > start) kept.push([start, cut[0]]);
    if (cut[1] < end) kept.push([cut[1], end]);
    return kept;
  });
}

export function clipSegment(segment: Segment, circles: readonly Circle[]): Segment[] {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return [];
  let intervals: [number, number][] = [[0, 1]];
  for (const circle of circles) {
    const fx = segment.a.x - circle.x;
    const fy = segment.a.y - circle.y;
    const half = fx * dx + fy * dy;
    const constant = fx * fx + fy * fy - circle.r * circle.r;
    const discriminant = half * half - lengthSquared * constant;
    if (discriminant <= 0) continue;
    const root = Math.sqrt(discriminant);
    intervals = subtractInterval(intervals, [(-half - root) / lengthSquared, (-half + root) / lengthSquared]);
  }
  const length = Math.sqrt(lengthSquared);
  const at = (t: number): Point => ({ x: segment.a.x + dx * t, y: segment.a.y + dy * t });
  return intervals.filter(([start, end]) => (end - start) * length > MIN_PIECE).map(([start, end]) => ({ a: at(start), b: at(end), width: segment.width }));
}

export function dashSegment(segment: Segment, pattern: readonly number[]): Segment[] {
  const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
  const cycle = pattern.reduce((sum, value) => sum + value, 0);
  if (length === 0 || cycle <= 0 || pattern.length < 2) return [segment];
  const ux = (segment.b.x - segment.a.x) / length;
  const uy = (segment.b.y - segment.a.y) / length;
  const pieces: Segment[] = [];
  let distance = 0;
  let index = 0;
  while (distance < length) {
    const next = Math.min(length, distance + pattern[index % pattern.length]);
    if (index % 2 === 0) pieces.push({ a: { x: segment.a.x + ux * distance, y: segment.a.y + uy * distance }, b: { x: segment.a.x + ux * next, y: segment.a.y + uy * next }, width: segment.width });
    distance = next;
    index += 1;
  }
  return pieces;
}

function centroid(points: readonly Point[]): Point {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function clipByHalfPlane(points: readonly Point[], origin: Point, normal: Point, offset: number): Point[] {
  const side = (point: Point) => (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y - offset;
  const kept: Point[] = [];
  points.forEach((current, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const [sideCurrent, sidePrevious] = [side(current), side(previous)];
    if (sideCurrent >= 0 !== sidePrevious >= 0) {
      const t = sidePrevious / (sidePrevious - sideCurrent);
      kept.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t });
    }
    if (sideCurrent >= 0) kept.push(current);
  });
  return kept;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function reachesCircle(shape: readonly Point[], circle: Circle): boolean {
  return shape.some((point, index) => distanceToSegment(circle, point, shape[(index + 1) % shape.length]) < circle.r);
}

export function clipWedge(points: readonly Point[], circles: readonly Circle[]): Point[] {
  let shape = [...points];
  for (const circle of circles) {
    if (shape.length < 3 || !reachesCircle(shape, circle)) continue;
    const middle = centroid(shape);
    const distance = Math.hypot(middle.x - circle.x, middle.y - circle.y);
    if (distance === 0) continue;
    shape = clipByHalfPlane(shape, circle, { x: (middle.x - circle.x) / distance, y: (middle.y - circle.y) / distance }, circle.r);
  }
  return shape.length >= 3 ? shape : [];
}

function numberOf(element: Element, name: string, fallback = 0): number {
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function pointsOf(element: Element): Point[] {
  const values = (element.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) if (Number.isFinite(values[index]) && Number.isFinite(values[index + 1])) points.push({ x: values[index], y: values[index + 1] });
  return points;
}

function translationOf(element: Element): Point | null {
  const style = element.getAttribute("style") ?? "";
  const x = /translateX\(\s*(-?[\d.e+-]+)px\s*\)/.exec(style);
  const y = /translateY\(\s*(-?[\d.e+-]+)px\s*\)/.exec(style);
  return x && y ? { x: Number(x[1]), y: Number(y[1]) } : null;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DIRECTIONS: readonly Direction[] = ["left", "right", "up", "down"];

function directionOf(value: string | null): Direction {
  return DIRECTIONS.find((direction) => direction === value) ?? "right";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function include(box: Box, x0: number, y0: number, x1: number, y1: number): void {
  box.x0 = Math.min(box.x0, x0);
  box.y0 = Math.min(box.y0, y0);
  box.x1 = Math.max(box.x1, x1);
  box.y1 = Math.max(box.y1, y1);
}

export function normalizeMoleculeSvg(root: Element, ink: string): MoleculeArt | null {
  const layers = [...root.children].filter((child) => child.localName === "g");
  const paths = layers.find((layer) => layer.hasAttribute("mask"));
  const vertices = paths ? paths.nextElementSibling : null;
  if (!paths) return null;

  const circles: Circle[] = [...root.querySelectorAll("mask circle")].map((circle) => ({ x: numberOf(circle, "cx"), y: numberOf(circle, "cy"), r: numberOf(circle, "r") }));
  const segments: Segment[] = [];
  const wedges: Point[][] = [];
  const rings: Circle[] = [];
  const ringWidths: number[] = [];
  const bondEnds: Point[] = [];

  for (const element of paths.children) {
    if (element.localName === "line") {
      const segment = { a: { x: numberOf(element, "x1"), y: numberOf(element, "y1") }, b: { x: numberOf(element, "x2"), y: numberOf(element, "y2") }, width: numberOf(element, "stroke-width", 1) };
      bondEnds.push(segment.a, segment.b);
      const dash = element.getAttribute("stroke-dasharray");
      const pattern = dash ? dash.split(/[\s,]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0) : [];
      const pieces = dash ? dashSegment(segment, pattern.length >= 2 ? pattern : DEFAULT_DASH) : [segment];
      segments.push(...pieces.flatMap((piece) => clipSegment(piece, circles)));
    } else if (element.localName === "polygon") {
      const outline = pointsOf(element);
      bondEnds.push(...outline);
      const shape = clipWedge(outline, circles);
      if (shape.length) wedges.push(shape);
    } else if (element.localName === "circle") {
      rings.push({ x: numberOf(element, "cx"), y: numberOf(element, "cy"), r: numberOf(element, "r") });
      ringWidths.push(numberOf(element, "stroke-width", 1));
    }
  }

  const dots: Circle[] = [];
  const glyphs: Glyph[] = [];
  [...(vertices?.children ?? [])].forEach((element, index) => {
    if (element.localName === "circle") {
      dots.push({ x: numberOf(element, "cx"), y: numberOf(element, "cy"), r: numberOf(element, "r") });
      return;
    }
    const text = element.querySelector("text");
    const translation = translationOf(element);
    const atom = circles[index] ?? translation;
    if (!text || !atom) return;
    const parts = [...text.querySelectorAll("tspan")].map((span) => {
      const fill = span.getAttribute("fill") ?? "";
      return { text: span.textContent ?? "", color: HEX_COLOR.test(fill) ? fill : ink };
    });
    const reach = "r" in atom ? atom.r : 0;
    const bonded = bondEnds.some((end) => Math.hypot(end.x - atom.x, end.y - atom.y) <= reach);
    glyphs.push(...layoutLabel({ x: atom.x, y: atom.y, direction: bonded ? directionOf(text.getAttribute("data-direction")) : "right", parts }));
  });

  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const segment of segments) {
    const half = segment.width / 2;
    include(box, Math.min(segment.a.x, segment.b.x) - half, Math.min(segment.a.y, segment.b.y) - half, Math.max(segment.a.x, segment.b.x) + half, Math.max(segment.a.y, segment.b.y) + half);
  }
  for (const shape of wedges) for (const point of shape) include(box, point.x, point.y, point.x, point.y);
  rings.forEach((ring, index) => include(box, ring.x - ring.r - ringWidths[index] / 2, ring.y - ring.r - ringWidths[index] / 2, ring.x + ring.r + ringWidths[index] / 2, ring.y + ring.r + ringWidths[index] / 2));
  for (const dot of dots) include(box, dot.x - dot.r, dot.y - dot.r, dot.x + dot.r, dot.y + dot.r);
  for (const glyph of glyphs) include(box, glyph.x, glyph.y - ASCENT * glyph.size, glyph.x + textAdvance(glyph.text, glyph.size), glyph.y + DESCENT * glyph.size);
  if (!Number.isFinite(box.x0)) return null;

  const x0 = box.x0 - PADDING;
  const y0 = box.y0 - PADDING;
  const width = round(box.x1 - box.x0 + PADDING * 2);
  const height = round(box.y1 - box.y0 + PADDING * 2);
  const at = (value: number, origin: number) => round(value - origin);

  const body = [
    ...segments.map((segment) => `<line x1="${at(segment.a.x, x0)}" y1="${at(segment.a.y, y0)}" x2="${at(segment.b.x, x0)}" y2="${at(segment.b.y, y0)}" stroke-width="${round(segment.width)}"/>`),
    ...rings.map((ring, index) => `<circle cx="${at(ring.x, x0)}" cy="${at(ring.y, y0)}" r="${round(ring.r)}" stroke-width="${round(ringWidths[index])}"/>`),
    ...wedges.map((shape) => `<polygon points="${shape.map((point) => `${at(point.x, x0)},${at(point.y, y0)}`).join(" ")}" fill="${ink}" stroke="none"/>`),
    ...dots.map((dot) => `<circle cx="${at(dot.x, x0)}" cy="${at(dot.y, y0)}" r="${round(dot.r)}" fill="${ink}" stroke="none"/>`),
    ...glyphs.map((glyph) => `<text x="${at(glyph.x, x0)}" y="${at(glyph.y, y0)}" font-family="${LABEL_FONT_FAMILY}" font-size="${round(glyph.size)}" fill="${glyph.color}" stroke="none">${escapeText(glyph.text)}</text>`),
  ].join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><g fill="none" stroke="${ink}" stroke-linecap="round">${body}</g></svg>`;
  return { svg, width, height };
}

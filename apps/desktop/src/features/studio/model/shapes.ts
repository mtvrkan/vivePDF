import type {
  StudioArrowhead,
  StudioCornerRadii,
  StudioDash,
  StudioFill,
  StudioGradientStop,
  StudioLineCap,
  StudioLineJoin,
  StudioRenderFill,
  StudioRenderPath,
  StudioRenderStroke,
  StudioShapeElement,
  StudioShapeKind,
  StudioStroke,
} from "@/types/studio";

const KAPPA = 0.5522847498;

type Point = [number, number];

export function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function polygon(points: Point[]): string {
  return `${points.map(([x, y], index) => `${index ? "L" : "M"}${num(x)} ${num(y)}`).join(" ")} Z`;
}

function fitted(points: Point[], width: number, height: number): Point[] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const spanX = Math.max(...xs) - left || 1;
  const spanY = Math.max(...ys) - top || 1;
  return points.map(([x, y]) => [((x - left) / spanX) * width, ((y - top) / spanY) * height]);
}

function regular(sides: number, startDegrees: number): Point[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = ((startDegrees + (360 / sides) * index) * Math.PI) / 180;
    return [Math.cos(angle), Math.sin(angle)] as Point;
  });
}

function starPoints(points: number, innerRatio: number): Point[] {
  const count = Math.max(3, Math.round(points));
  return Array.from({ length: count * 2 }, (_, index) => {
    const radius = index % 2 ? innerRatio : 1;
    const angle = ((-90 + (180 / count) * index) * Math.PI) / 180;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as Point;
  });
}

export function clampedCorners(width: number, height: number, radii: readonly number[]): StudioCornerRadii {
  const limit = Math.max(0, Math.min(width, height) / 2);
  return [0, 1, 2, 3].map((index) => Math.max(0, Math.min(Number.isFinite(radii[index]) ? radii[index] : 0, limit))) as StudioCornerRadii;
}

function corner(radius: number, from: Point, control: Point, to: Point): string[] {
  if (radius <= 0) return [];
  const first: Point = [from[0] + (control[0] - from[0]) * KAPPA, from[1] + (control[1] - from[1]) * KAPPA];
  const second: Point = [to[0] + (control[0] - to[0]) * KAPPA, to[1] + (control[1] - to[1]) * KAPPA];
  return [`C${num(first[0])} ${num(first[1])} ${num(second[0])} ${num(second[1])} ${num(to[0])} ${num(to[1])}`];
}

export function cornerRect(x: number, y: number, width: number, height: number, radii: readonly number[]): string {
  const [tl, tr, br, bl] = clampedCorners(width, height, radii);
  const right = x + width;
  const bottom = y + height;
  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) return polygon([[x, y], [right, y], [right, bottom], [x, bottom]]);
  return [
    `M${num(x + tl)} ${num(y)}`,
    `L${num(right - tr)} ${num(y)}`,
    ...corner(tr, [right - tr, y], [right, y], [right, y + tr]),
    `L${num(right)} ${num(bottom - br)}`,
    ...corner(br, [right, bottom - br], [right, bottom], [right - br, bottom]),
    `L${num(x + bl)} ${num(bottom)}`,
    ...corner(bl, [x + bl, bottom], [x, bottom], [x, bottom - bl]),
    `L${num(x)} ${num(y + tl)}`,
    ...corner(tl, [x, y + tl], [x, y], [x + tl, y]),
    "Z",
  ].join(" ");
}

export function roundedRect(x: number, y: number, width: number, height: number, radius: number): string {
  return cornerRect(x, y, width, height, [radius, radius, radius, radius]);
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    `M${num(cx)} ${num(cy - ry)}`,
    `C${num(cx + kx)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - ky)} ${num(cx + rx)} ${num(cy)}`,
    `C${num(cx + rx)} ${num(cy + ky)} ${num(cx + kx)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)}`,
    `C${num(cx - kx)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + ky)} ${num(cx - rx)} ${num(cy)}`,
    `C${num(cx - rx)} ${num(cy - ky)} ${num(cx - kx)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)}`,
    "Z",
  ].join(" ");
}

function heart(width: number, height: number): string {
  const x = (value: number) => num((value / 100) * width);
  const y = (value: number) => num((value / 100) * height);
  return [
    `M${x(50)} ${y(100)}`,
    `C${x(18)} ${y(76)} ${x(0)} ${y(56)} ${x(0)} ${y(30)}`,
    `C${x(0)} ${y(12)} ${x(13)} ${y(0)} ${x(28)} ${y(0)}`,
    `C${x(38)} ${y(0)} ${x(46)} ${y(6)} ${x(50)} ${y(15)}`,
    `C${x(54)} ${y(6)} ${x(62)} ${y(0)} ${x(72)} ${y(0)}`,
    `C${x(87)} ${y(0)} ${x(100)} ${y(12)} ${x(100)} ${y(30)}`,
    `C${x(100)} ${y(56)} ${x(82)} ${y(76)} ${x(50)} ${y(100)}`,
    "Z",
  ].join(" ");
}

function speech(width: number, height: number, radius: number): string {
  const body = height * 0.8;
  const r = Math.max(0, Math.min(radius || Math.min(width, body) * 0.15, width / 2, body / 2));
  const k = r * KAPPA;
  return [
    `M${num(r)} 0`,
    `L${num(width - r)} 0`,
    `C${num(width - r + k)} 0 ${num(width)} ${num(r - k)} ${num(width)} ${num(r)}`,
    `L${num(width)} ${num(body - r)}`,
    `C${num(width)} ${num(body - r + k)} ${num(width - r + k)} ${num(body)} ${num(width - r)} ${num(body)}`,
    `L${num(width * 0.38)} ${num(body)}`,
    `L${num(width * 0.18)} ${num(height)}`,
    `L${num(width * 0.22)} ${num(body)}`,
    `L${num(r)} ${num(body)}`,
    `C${num(r - k)} ${num(body)} 0 ${num(body - r + k)} 0 ${num(body - r)}`,
    `L0 ${num(r)}`,
    `C0 ${num(r - k)} ${num(r - k)} 0 ${num(r)} 0`,
    "Z",
  ].join(" ");
}

type Circle = [number, number, number];
type Cubic = [Point, Point, Point, Point];

const CLOUD_CIRCLES: Circle[] = [[20, 40, 15], [36, 24, 17], [60, 18, 18], [80, 32, 15], [82, 47, 11], [60, 50, 12], [38, 50, 12]];
const QUARTER = Math.PI / 2;

function outerJoint(first: Circle, second: Circle, centre: Point): Point {
  const [x1, y1, r1] = first;
  const [x2, y2, r2] = second;
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const along = (distance * distance + r1 * r1 - r2 * r2) / (2 * distance);
  const reach = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const mid: Point = [x1 + (along * (x2 - x1)) / distance, y1 + (along * (y2 - y1)) / distance];
  const offset: Point = [(-(y2 - y1) / distance) * reach, ((x2 - x1) / distance) * reach];
  const candidates: Point[] = [[mid[0] + offset[0], mid[1] + offset[1]], [mid[0] - offset[0], mid[1] - offset[1]]];
  return candidates.reduce((best, point) => (Math.hypot(point[0] - centre[0], point[1] - centre[1]) > Math.hypot(best[0] - centre[0], best[1] - centre[1]) ? point : best));
}

function arcCubics([x, y, r]: Circle, from: Point, to: Point): Cubic[] {
  const start = Math.atan2(from[1] - y, from[0] - x);
  let end = Math.atan2(to[1] - y, to[0] - x);
  while (end <= start) end += Math.PI * 2;
  const cuts = [start];
  for (let step = Math.ceil(start / QUARTER + 1e-9); step * QUARTER < end - 1e-9; step += 1) cuts.push(step * QUARTER);
  cuts.push(end);
  return cuts.slice(1).map((next, index) => {
    const previous = cuts[index];
    const handle = (4 / 3) * Math.tan((next - previous) / 4) * r;
    const first: Point = [x + r * Math.cos(previous), y + r * Math.sin(previous)];
    const last: Point = [x + r * Math.cos(next), y + r * Math.sin(next)];
    return [first, [first[0] - handle * Math.sin(previous), first[1] + handle * Math.cos(previous)], [last[0] + handle * Math.sin(next), last[1] - handle * Math.cos(next)], last];
  });
}

function cloud(width: number, height: number): string {
  const centre: Point = [CLOUD_CIRCLES.reduce((sum, [x]) => sum + x, 0) / CLOUD_CIRCLES.length, CLOUD_CIRCLES.reduce((sum, [, y]) => sum + y, 0) / CLOUD_CIRCLES.length];
  const joints = CLOUD_CIRCLES.map((circle, index) => outerJoint(circle, CLOUD_CIRCLES[(index + 1) % CLOUD_CIRCLES.length], centre));
  const cubics = CLOUD_CIRCLES.flatMap((circle, index) => arcCubics(circle, joints[(index + joints.length - 1) % joints.length], joints[index]));
  const ends = cubics.flatMap(([first, , , last]) => [first, last]);
  const left = Math.min(...ends.map(([x]) => x));
  const top = Math.min(...ends.map(([, y]) => y));
  const scaleX = width / (Math.max(...ends.map(([x]) => x)) - left);
  const scaleY = height / (Math.max(...ends.map(([, y]) => y)) - top);
  const at = ([x, y]: Point) => `${num(Math.min(width, Math.max(0, (x - left) * scaleX)))} ${num(Math.min(height, Math.max(0, (y - top) * scaleY)))}`;
  return [`M${at(cubics[0][0])}`, ...cubics.map(([, first, second, last]) => `C${at(first)} ${at(second)} ${at(last)}`), "Z"].join(" ");
}

export function shapeD(shape: StudioShapeKind, width: number, height: number, options: { cornerRadius?: number; corners?: StudioCornerRadii | null; points?: number; innerRatio?: number } = {}): string {
  const w = width;
  const h = height;
  switch (shape) {
    case "rect":
      return options.corners ? cornerRect(0, 0, w, h, options.corners) : roundedRect(0, 0, w, h, options.cornerRadius ?? 0);
    case "cloud":
      return cloud(w, h);
    case "ellipse":
      return ellipse(w / 2, h / 2, w / 2, h / 2);
    case "triangle":
      return polygon([[w / 2, 0], [w, h], [0, h]]);
    case "rightTriangle":
      return polygon([[0, 0], [w, h], [0, h]]);
    case "diamond":
      return polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case "pentagon":
      return polygon(fitted(regular(5, -90), w, h));
    case "hexagon":
      return polygon(fitted(regular(6, 0), w, h));
    case "octagon":
      return polygon(fitted(regular(8, 22.5), w, h));
    case "star":
    case "burst":
      return polygon(fitted(starPoints(options.points ?? 5, options.innerRatio ?? 0.45), w, h));
    case "heart":
      return heart(w, h);
    case "arrow": {
      const head = Math.min(w * 0.45, h);
      return polygon([[0, h * 0.25], [w - head, h * 0.25], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.75], [0, h * 0.75]]);
    }
    case "chevron": {
      const depth = Math.min(w * 0.4, h / 2);
      return polygon([[0, 0], [w - depth, 0], [w, h / 2], [w - depth, h], [0, h], [depth, h / 2]]);
    }
    case "parallelogram": {
      const slant = Math.min(w * 0.25, h * 0.6);
      return polygon([[slant, 0], [w, 0], [w - slant, h], [0, h]]);
    }
    case "trapezoid": {
      const inset = w * 0.2;
      return polygon([[inset, 0], [w - inset, 0], [w, h], [0, h]]);
    }
    case "cross": {
      const tx = w / 3;
      const ty = h / 3;
      return polygon([[tx, 0], [2 * tx, 0], [2 * tx, ty], [w, ty], [w, 2 * ty], [2 * tx, 2 * ty], [2 * tx, h], [tx, h], [tx, 2 * ty], [0, 2 * ty], [0, ty], [tx, ty]]);
    }
    case "speech":
      return speech(w, h, options.cornerRadius ?? 0);
    case "line":
    case "arrowLine":
      return `M0 ${num(h / 2)} L${num(w)} ${num(h / 2)}`;
  }
}

export function linearGradientLine(angle: number, width: number, height: number): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  return { x1: cx - (dx * length) / 2, y1: cy - (dy * length) / 2, x2: cx + (dx * length) / 2, y2: cy + (dy * length) / 2 };
}

const MAX_RENDER_RADIUS = 20000;
const MAX_DASH_LENGTH = 2000;

type DashPiece = { on: number } | { dot: true } | { off: number };

const DASH_PATTERNS: Record<Exclude<StudioDash, "solid">, DashPiece[]> = {
  dashed: [{ on: 3 }, { off: 2 }],
  dotted: [{ dot: true }, { off: 1 }],
  longDash: [{ on: 7 }, { off: 3 }],
  dashDot: [{ on: 4 }, { off: 2 }, { dot: true }, { off: 2 }],
};

export function sortedStops(stops: StudioGradientStop[]): StudioGradientStop[] {
  return [...stops].sort((left, right) => left.offset - right.offset);
}

export function renderFill(fill: StudioFill, width: number, height: number): StudioRenderFill | null {
  switch (fill.type) {
    case "none":
      return null;
    case "solid":
      return { type: "solid", color: fill.color };
    case "linear":
      return { type: "linear", ...linearGradientLine(fill.angle, width, height), stops: sortedStops(fill.stops) };
    case "radial": {
      const r = (Math.hypot(width, height) / 2) * (fill.radius ?? 1);
      return { type: "radial", cx: width * (fill.cx ?? 0.5), cy: height * (fill.cy ?? 0.5), r: Math.min(MAX_RENDER_RADIUS, Math.max(0.01, r)), stops: sortedStops(fill.stops) };
    }
  }
}

export function strokeCap(stroke: StudioStroke): StudioLineCap {
  return stroke.cap ?? (stroke.dash === "dotted" ? "round" : "butt");
}

export function strokeJoin(stroke: StudioStroke): StudioLineJoin {
  return stroke.join ?? (stroke.dash === "dotted" ? "round" : "miter");
}

function dashArray(stroke: StudioStroke, cap: StudioLineCap): number[] {
  if (stroke.dash === "solid") return [];
  const unit = stroke.width;
  const capLength = cap === "butt" ? 0 : unit;
  const gap = stroke.gap ?? 1;
  const length = (value: number) => Math.min(MAX_DASH_LENGTH, Math.max(0, value));
  return DASH_PATTERNS[stroke.dash].map((piece) => {
    if ("dot" in piece) return capLength ? 0 : length(unit);
    if ("on" in piece) return length(piece.on * unit - capLength);
    return length(piece.off * unit * gap + capLength);
  });
}

export function renderStroke(stroke: StudioStroke | null): StudioRenderStroke | null {
  if (!stroke || stroke.width <= 0) return null;
  const cap = strokeCap(stroke);
  return { color: stroke.color, width: stroke.width, dash: dashArray(stroke, cap), cap, join: strokeJoin(stroke) };
}

const HEAD_RATIO = 3.5;
const MIN_HEAD = 6;
const OPEN_ARROW_MITER = 1 / Math.sin(Math.atan(0.5));

export function isLineShape(shape: StudioShapeKind): boolean {
  return shape === "line" || shape === "arrowLine";
}

export function arrowheadLength(strokeWidth: number, size: number, available: number): number {
  return Math.max(0, Math.min(available, Math.max(strokeWidth * HEAD_RATIO, MIN_HEAD) * size));
}

export type Arrowhead = { paths: StudioRenderPath[]; inset: number };

export function arrowhead(kind: StudioArrowhead, tipX: number, mid: number, direction: 1 | -1, length: number, stroke: StudioRenderStroke): Arrowhead {
  const back = (distance: number, across = 0): Point => [tipX - direction * distance, mid + across];
  const at = (point: Point) => `${num(point[0])} ${num(point[1])}`;
  const solid = (d: string): StudioRenderPath => ({ d, fill: { type: "solid", color: stroke.color }, stroke: null, evenOdd: false, opacity: 1 });
  const half = length / 2;
  switch (kind) {
    case "none":
      return { paths: [], inset: 0 };
    case "arrow":
      return { paths: [solid(polygon([back(0), back(length, -half), back(length * 0.75), back(length, half)]))], inset: length * 0.6 };
    case "openArrow": {
      const offset = (stroke.width / 2) * OPEN_ARROW_MITER;
      const d = `M${at(back(length + offset, -half))} L${at(back(offset))} L${at(back(length + offset, half))}`;
      return { paths: [{ d, fill: null, stroke: { ...stroke, dash: [], join: "miter" }, evenOdd: false, opacity: 1 }], inset: offset };
    }
    case "triangle":
      return { paths: [solid(polygon([back(0), back(length, -half), back(length, half)]))], inset: length * 0.8 };
    case "circle":
      return { paths: [solid(ellipse(tipX, mid, length * 0.4, length * 0.4))], inset: 0 };
    case "square": {
      const side = length * 0.4;
      return { paths: [solid(polygon([[tipX - side, mid - side], [tipX + side, mid - side], [tipX + side, mid + side], [tipX - side, mid + side]]))], inset: 0 };
    }
    case "bar": {
      const thickness = Math.max(stroke.width, 1) / 2;
      return { paths: [solid(polygon([[tipX - thickness, mid - half], [tipX + thickness, mid - half], [tipX + thickness, mid + half], [tipX - thickness, mid + half]]))], inset: 0 };
    }
  }
}

function linePaths(element: StudioShapeElement): StudioRenderPath[] {
  const stroke = renderStroke(element.stroke);
  if (!stroke) return [];
  const width = element.width;
  const mid = element.height / 2;
  const both = element.startArrow !== "none" && element.endArrow !== "none";
  const length = arrowheadLength(stroke.width, element.arrowSize, both ? width / 2 : width);
  const start = arrowhead(element.startArrow, 0, mid, -1, length, stroke);
  const end = arrowhead(element.endArrow, width, mid, 1, length, stroke);
  const from = start.inset;
  const to = Math.max(from, width - end.inset);
  const shaft: StudioRenderPath = { d: `M${num(from)} ${num(mid)} L${num(to)} ${num(mid)}`, fill: null, stroke, evenOdd: false, opacity: 1 };
  return [shaft, ...start.paths, ...end.paths];
}

export function shapePaths(element: StudioShapeElement): StudioRenderPath[] {
  if (isLineShape(element.shape)) return linePaths(element);
  const d = shapeD(element.shape, element.width, element.height, element);
  const fill = renderFill(element.fill, element.width, element.height);
  const stroke = renderStroke(element.stroke);
  if (!fill && !stroke) return [];
  return [{ d, fill, stroke, evenOdd: false, opacity: 1 }];
}

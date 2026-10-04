import type {
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

export function roundedRect(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r <= 0) return polygon([[x, y], [x + width, y], [x + width, y + height], [x, y + height]]);
  const k = r * KAPPA;
  const right = x + width;
  const bottom = y + height;
  return [
    `M${num(x + r)} ${num(y)}`,
    `L${num(right - r)} ${num(y)}`,
    `C${num(right - r + k)} ${num(y)} ${num(right)} ${num(y + r - k)} ${num(right)} ${num(y + r)}`,
    `L${num(right)} ${num(bottom - r)}`,
    `C${num(right)} ${num(bottom - r + k)} ${num(right - r + k)} ${num(bottom)} ${num(right - r)} ${num(bottom)}`,
    `L${num(x + r)} ${num(bottom)}`,
    `C${num(x + r - k)} ${num(bottom)} ${num(x)} ${num(bottom - r + k)} ${num(x)} ${num(bottom - r)}`,
    `L${num(x)} ${num(y + r)}`,
    `C${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)}`,
    "Z",
  ].join(" ");
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

export function shapeD(shape: StudioShapeKind, width: number, height: number, options: { cornerRadius?: number; points?: number; innerRatio?: number } = {}): string {
  const w = width;
  const h = height;
  switch (shape) {
    case "rect":
      return roundedRect(0, 0, w, h, options.cornerRadius ?? 0);
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

function arrowLinePaths(element: StudioShapeElement): StudioRenderPath[] {
  const stroke = renderStroke(element.stroke);
  if (!stroke) return [];
  const head = Math.min(element.width, Math.max(stroke.width * 3.5, 6));
  const mid = element.height / 2;
  const shaftEnd = Math.max(0, element.width - head * 0.8);
  return [
    { d: `M0 ${num(mid)} L${num(shaftEnd)} ${num(mid)}`, fill: null, stroke, evenOdd: false, opacity: 1 },
    { d: polygon([[element.width, mid], [element.width - head, mid - head / 2], [element.width - head, mid + head / 2]]), fill: { type: "solid", color: stroke.color }, stroke: null, evenOdd: false, opacity: 1 },
  ];
}

export function shapePaths(element: StudioShapeElement): StudioRenderPath[] {
  if (element.shape === "arrowLine") return arrowLinePaths(element);
  const d = shapeD(element.shape, element.width, element.height, element);
  const lineLike = element.shape === "line";
  const fill = lineLike ? null : renderFill(element.fill, element.width, element.height);
  const stroke = renderStroke(element.stroke);
  if (!fill && !stroke) return [];
  return [{ d, fill, stroke, evenOdd: false, opacity: 1 }];
}

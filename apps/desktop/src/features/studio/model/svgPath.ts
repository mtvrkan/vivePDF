import { ellipse, num } from "./shapes";

const KAPPA = 0.5522847498;
const MAX_ARC_SEGMENT = Math.PI / 2;
const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const ARGUMENTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

type Point = [number, number];

class Scanner {
  private index = 0;

  constructor(private readonly text: string) {}

  private skip(): void {
    while (this.index < this.text.length && /[\s,]/.test(this.text[this.index])) this.index += 1;
  }

  done(): boolean {
    this.skip();
    return this.index >= this.text.length;
  }

  command(): string | null {
    this.skip();
    const char = this.text[this.index];
    if (char && COMMAND.test(char)) {
      this.index += 1;
      return char;
    }
    return null;
  }

  number(): number {
    this.skip();
    const match = NUMBER.exec(this.text.slice(this.index, this.index + 64));
    if (!match) throw new Error("path data is malformed");
    this.index += match[0].length;
    return Number(match[0]);
  }

  flag(): number {
    this.skip();
    const char = this.text[this.index];
    if (char !== "0" && char !== "1") throw new Error("path data is malformed");
    this.index += 1;
    return Number(char);
  }
}

function arcToCubics(from: Point, rxIn: number, ryIn: number, angleDegrees: number, large: number, sweep: number, to: Point): Point[][] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if ((from[0] === to[0] && from[1] === to[1]) || rx === 0 || ry === 0) return [];
  const phi = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxPrime = (factor * rx * y1) / ry;
  const cyPrime = (-factor * ry * x1) / rx;
  const cx = cos * cxPrime - sin * cyPrime + (from[0] + to[0]) / 2;
  const cy = sin * cxPrime + cos * cyPrime + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const startX = (x1 - cxPrime) / rx;
  const startY = (y1 - cyPrime) / ry;
  const start = angle(1, 0, startX, startY);
  let delta = angle(startX, startY, (-x1 - cxPrime) / rx, (-y1 - cyPrime) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(delta) / MAX_ARC_SEGMENT - 1e-9));
  const step = delta / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const pointAt = (theta: number, scale = 1, derivative = false): Point => {
    const ex = derivative ? -Math.sin(theta) * rx * scale : Math.cos(theta) * rx;
    const ey = derivative ? Math.cos(theta) * ry * scale : Math.sin(theta) * ry;
    return [cos * ex - sin * ey + (derivative ? 0 : cx), sin * ex + cos * ey + (derivative ? 0 : cy)];
  };
  const curves: Point[][] = [];
  for (let index = 0; index < count; index += 1) {
    const a = start + step * index;
    const b = a + step;
    const p0 = pointAt(a);
    const p3 = index === count - 1 ? to : pointAt(b);
    const d0 = pointAt(a, k, true);
    const d3 = pointAt(b, k, true);
    curves.push([
      [p0[0] + d0[0], p0[1] + d0[1]],
      [p3[0] - d3[0], p3[1] - d3[1]],
      p3,
    ]);
  }
  return curves;
}

export function normalizePathData(data: string): string {
  const scanner = new Scanner(data);
  const out: string[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  let lastCubic: Point | null = null;
  let lastQuad: Point | null = null;
  let command: string | null = null;
  const point = (p: Point) => `${num(p[0])} ${num(p[1])}`;
  while (!scanner.done()) {
    const next = scanner.command();
    if (next) command = next;
    else if (!command || command === "Z" || command === "z") throw new Error("path data is malformed");
    if (!command) break;
    const upper: string = command.toUpperCase();
    const relative: boolean = command !== upper;
    const base = (p: Point): Point => (relative ? [p[0] + current[0], p[1] + current[1]] : p);
    if (upper === "Z") {
      if (out.length) out.push("Z");
      current = start;
      lastCubic = lastQuad = null;
      continue;
    }
    if (!out.length && upper !== "M") throw new Error("path data must start with a move");
    const count = ARGUMENTS[upper];
    const values = upper === "A" ? [scanner.number(), scanner.number(), scanner.number(), scanner.flag(), scanner.flag(), scanner.number(), scanner.number()] : Array.from({ length: count }, () => scanner.number());
    let cubic: Point | null = null;
    let quad: Point | null = null;
    switch (upper) {
      case "M": {
        current = base([values[0], values[1]]);
        start = current;
        out.push(`M${point(current)}`);
        command = relative ? "l" : "L";
        break;
      }
      case "L":
        current = base([values[0], values[1]]);
        out.push(`L${point(current)}`);
        break;
      case "H":
        current = [relative ? current[0] + values[0] : values[0], current[1]];
        out.push(`L${point(current)}`);
        break;
      case "V":
        current = [current[0], relative ? current[1] + values[0] : values[0]];
        out.push(`L${point(current)}`);
        break;
      case "C":
      case "S": {
        const first: Point = upper === "C" ? base([values[0], values[1]]) : lastCubic ? [2 * current[0] - lastCubic[0], 2 * current[1] - lastCubic[1]] : current;
        const rest = upper === "C" ? values.slice(2) : values;
        const second = base([rest[0], rest[1]]);
        const end = base([rest[2], rest[3]]);
        out.push(`C${point(first)} ${point(second)} ${point(end)}`);
        cubic = second;
        current = end;
        break;
      }
      case "Q":
      case "T": {
        const control: Point = upper === "Q" ? base([values[0], values[1]]) : lastQuad ? [2 * current[0] - lastQuad[0], 2 * current[1] - lastQuad[1]] : current;
        const end = upper === "Q" ? base([values[2], values[3]]) : base([values[0], values[1]]);
        out.push(`Q${point(control)} ${point(end)}`);
        quad = control;
        current = end;
        break;
      }
      case "A": {
        const end = base([values[5], values[6]]);
        const curves = arcToCubics(current, values[0], values[1], values[2], values[3], values[4], end);
        if (!curves.length && (end[0] !== current[0] || end[1] !== current[1])) out.push(`L${point(end)}`);
        for (const [c1, c2, p] of curves) out.push(`C${point(c1)} ${point(c2)} ${point(p)}`);
        current = end;
        break;
      }
    }
    lastCubic = cubic;
    lastQuad = quad;
  }
  return out.join(" ");
}

function attribute(attrs: Readonly<Record<string, string>>, name: string, fallback = 0): number {
  const value = Number.parseFloat(attrs[name] ?? "");
  return Number.isFinite(value) ? value : fallback;
}

export function ellipticRect(x: number, y: number, width: number, height: number, rxIn: number, ryIn: number): string {
  const rx = Math.max(0, Math.min(rxIn, width / 2));
  const ry = Math.max(0, Math.min(ryIn, height / 2));
  const right = x + width;
  const bottom = y + height;
  if (rx <= 0 || ry <= 0) return `M${num(x)} ${num(y)} L${num(right)} ${num(y)} L${num(right)} ${num(bottom)} L${num(x)} ${num(bottom)} Z`;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    `M${num(x + rx)} ${num(y)}`,
    `L${num(right - rx)} ${num(y)}`,
    `C${num(right - rx + kx)} ${num(y)} ${num(right)} ${num(y + ry - ky)} ${num(right)} ${num(y + ry)}`,
    `L${num(right)} ${num(bottom - ry)}`,
    `C${num(right)} ${num(bottom - ry + ky)} ${num(right - rx + kx)} ${num(bottom)} ${num(right - rx)} ${num(bottom)}`,
    `L${num(x + rx)} ${num(bottom)}`,
    `C${num(x + rx - kx)} ${num(bottom)} ${num(x)} ${num(bottom - ry + ky)} ${num(x)} ${num(bottom - ry)}`,
    `L${num(x)} ${num(y + ry)}`,
    `C${num(x)} ${num(y + ry - ky)} ${num(x + rx - kx)} ${num(y)} ${num(x + rx)} ${num(y)}`,
    "Z",
  ].join(" ");
}

function pointList(value: string | undefined): Point[] {
  const numbers = (value ?? "").match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push([numbers[index], numbers[index + 1]]);
  return points;
}

export function primitivePath(tag: string, attrs: Readonly<Record<string, string>>): string {
  switch (tag) {
    case "path":
      return normalizePathData(attrs.d ?? "");
    case "circle": {
      const r = attribute(attrs, "r");
      return r > 0 ? ellipse(attribute(attrs, "cx"), attribute(attrs, "cy"), r, r) : "";
    }
    case "ellipse": {
      const rx = attribute(attrs, "rx");
      const ry = attribute(attrs, "ry");
      return rx > 0 && ry > 0 ? ellipse(attribute(attrs, "cx"), attribute(attrs, "cy"), rx, ry) : "";
    }
    case "rect": {
      const width = attribute(attrs, "width");
      const height = attribute(attrs, "height");
      if (width <= 0 || height <= 0) return "";
      const rx = attrs.rx !== undefined ? attribute(attrs, "rx") : attribute(attrs, "ry");
      const ry = attrs.ry !== undefined ? attribute(attrs, "ry") : rx;
      return ellipticRect(attribute(attrs, "x"), attribute(attrs, "y"), width, height, rx, ry);
    }
    case "line":
      return `M${num(attribute(attrs, "x1"))} ${num(attribute(attrs, "y1"))} L${num(attribute(attrs, "x2"))} ${num(attribute(attrs, "y2"))}`;
    case "polyline":
    case "polygon": {
      const points = pointList(attrs.points);
      if (points.length < 2) return "";
      const line = points.map(([x, y], index) => `${index ? "L" : "M"}${num(x)} ${num(y)}`).join(" ");
      return tag === "polygon" ? `${line} Z` : line;
    }
    default:
      return "";
  }
}

import { add, dashSegments, isFinitePrimitive, scale, sub, unit, type Anchor, type Point, type Primitive } from "./primitives";

export type ShapeStyle = { stroke: string; fill: string | null; weight: number; labels: boolean };
export type LabelArt = { svg: string; emWidth: number; emHeight: number };
export type RenderedShape = { svg: string; width: number; height: number };

export const DEFAULT_SHAPE_STYLE: ShapeStyle = { stroke: "#111111", fill: null, weight: 1.2, labels: true };
export const LABEL_SIZE = 12;
export const SOLID_TINT = "#2563eb";
const FILL_OPACITY = 0.3;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function safeColor(value: string | null, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value : fallback;
}

function shade(color: string, amount: number): string {
  const factor = Math.max(0, Math.min(1, amount));
  const channel = (offset: number) => Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * factor);
  return `#${[1, 3, 5].map((offset) => channel(offset).toString(16).padStart(2, "0")).join("")}`;
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function pathData(points: Point[], closed: boolean): string {
  const [first, ...rest] = points;
  return `M${fmt(first.x)} ${fmt(first.y)}${rest.map((item) => `L${fmt(item.x)} ${fmt(item.y)}`).join("")}${closed ? "Z" : ""}`;
}

function circlePoints(center: Point, radius: number): Point[] {
  return Array.from({ length: 96 }, (_, index) => ({ x: center.x + radius * Math.cos((index / 96) * Math.PI * 2), y: center.y + radius * Math.sin((index / 96) * Math.PI * 2) }));
}

function labelBox(primitive: Extract<Primitive, { type: "label" }>, art: LabelArt | undefined): { x: number; y: number; width: number; height: number } | null {
  if (!art) return null;
  const size = LABEL_SIZE * (primitive.scale ?? 1);
  const width = art.emWidth * size;
  const height = art.emHeight * size;
  const anchor: Anchor = primitive.anchor ?? "center";
  const dx = anchor.includes("w") ? 0 : anchor.includes("e") ? -width : -width / 2;
  const dy = anchor.startsWith("n") ? 0 : anchor.startsWith("s") ? -height : -height / 2;
  return { x: primitive.at.x + dx, y: primitive.at.y + dy, width, height };
}

function arrowHead(from: Point, to: Point, weight: number): { shaft: Point; head: Point[] } {
  const direction = unit(sub(to, from));
  const size = 5 + weight * 2.5;
  const back = sub(to, scale(direction, size));
  const normal = { x: -direction.y, y: direction.x };
  return { shaft: back, head: [to, add(back, scale(normal, size * 0.42)), add(back, scale(normal, -size * 0.42))] };
}

function extend(box: Box, item: Point, margin = 0) {
  box.minX = Math.min(box.minX, item.x - margin);
  box.minY = Math.min(box.minY, item.y - margin);
  box.maxX = Math.max(box.maxX, item.x + margin);
  box.maxY = Math.max(box.maxY, item.y + margin);
}

export function labelsOf(primitives: Primitive[]): string[] {
  return [...new Set(primitives.flatMap((item) => (item.type === "label" ? [item.latex] : [])))];
}

export function renderShape(primitives: Primitive[], style: ShapeStyle, labels: Map<string, LabelArt>): RenderedShape {
  const stroke = safeColor(style.stroke, "#111111");
  const fill = style.fill ? safeColor(style.fill, "#1d4ed8") : null;
  const base = Math.max(0.2, style.weight);
  const drawn = primitives.filter((item) => isFinitePrimitive(item) && (style.labels || item.type !== "label"));
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const parts: string[] = [];

  for (const item of drawn) {
    if (item.type === "label") {
      const art = labels.get(item.latex);
      const placed = labelBox(item, art);
      if (!art || !placed) continue;
      extend(box, { x: placed.x, y: placed.y });
      extend(box, { x: placed.x + placed.width, y: placed.y + placed.height });
      const view = /viewBox="([^"]+)"/.exec(art.svg)?.[1].trim().split(/[\s,]+/).map(Number) ?? [0, 0, 1, 1];
      const inner = art.svg.slice(art.svg.indexOf(">") + 1, art.svg.lastIndexOf("</svg>")).replaceAll("currentColor", safeColor(item.color ?? null, stroke));
      const factor = placed.width / view[2];
      parts.push(`<g transform="translate(${fmt(placed.x)} ${fmt(placed.y)}) scale(${factor.toPrecision(6)}) translate(${fmt(-view[0])} ${fmt(-view[1])})">${inner}</g>`);
      continue;
    }
    const weight = base * (item.type === "dot" ? 1 : (item.weight ?? 1));
    const strokeAttrs = `stroke="${item.type === "polyline" ? safeColor(item.color ?? null, stroke) : stroke}" stroke-width="${fmt(weight)}" stroke-linecap="round" stroke-linejoin="round"`;
    if (item.type === "dot") {
      extend(box, item.center, item.radius);
      parts.push(`<circle cx="${fmt(item.center.x)}" cy="${fmt(item.center.y)}" r="${fmt(item.radius)}" fill="${stroke}"/>`);
      continue;
    }
    if (item.type === "arrow") {
      const { shaft, head } = arrowHead(item.from, item.to, weight);
      const tail = item.both ? arrowHead(item.to, item.from, weight) : null;
      extend(box, item.from, weight * 4);
      extend(box, item.to, weight * 4);
      parts.push(`<path d="${pathData([tail ? tail.shaft : item.from, shaft], false)}" fill="none" ${strokeAttrs}/>`);
      parts.push(`<path d="${pathData(head, true)}" fill="${stroke}"/>`);
      if (tail) parts.push(`<path d="${pathData(tail.head, true)}" fill="${stroke}"/>`);
      continue;
    }
    const points = item.type === "circle" ? circlePoints(item.center, item.radius) : item.points;
    const closed = item.type === "circle" || !!item.closed;
    points.forEach((entry) => extend(box, entry, weight / 2));
    const line = item.line ?? "solid";
    const tint = fill ?? (item.solid ? SOLID_TINT : null);
    if (item.fill !== undefined && item.fill !== null && tint && closed) {
      parts.push(`<path d="${pathData(points, true)}" fill="${shade(tint, item.fill)}" fill-opacity="${FILL_OPACITY}" stroke="none"/>`);
    }
    if (line === "none") continue;
    if (line === "dashed") {
      const segments = dashSegments(points, closed, weight * 3.5 + 2, weight * 2.5 + 2);
      if (segments.length > 0) parts.push(`<path d="${segments.map((segment) => pathData(segment, false)).join("")}" fill="none" ${strokeAttrs}/>`);
      continue;
    }
    if (item.type === "circle") parts.push(`<circle cx="${fmt(item.center.x)}" cy="${fmt(item.center.y)}" r="${fmt(item.radius)}" fill="none" ${strokeAttrs}/>`);
    else parts.push(`<path d="${pathData(points, closed)}" fill="none" ${strokeAttrs}/>`);
  }

  if (!Number.isFinite(box.minX)) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1" height="1"/>', width: 1, height: 1 };
  const pad = 2 + base;
  const width = box.maxX - box.minX + pad * 2;
  const height = box.maxY - box.minY + pad * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(box.minX - pad)} ${fmt(box.minY - pad)} ${fmt(width)} ${fmt(height)}" width="${fmt(width)}" height="${fmt(height)}">${parts.join("")}</svg>`;
  return { svg, width, height };
}

export function shapeDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

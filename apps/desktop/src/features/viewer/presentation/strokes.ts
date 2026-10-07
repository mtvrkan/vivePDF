import { drawingBounds, ellipsePoints } from "@/shared/lib/drawingGeometry";
import type { Stroke, StrokePoint } from "@/shared/store/presentationStore";

const CANVAS_MARGIN_PX = 2;
const STROKE_REACH = 1;
export const HIGHLIGHTER_ALPHA = 0.45;
const ARROW_HEAD_MIN_PX = 10;
const ARROW_HEAD_PER_WIDTH = 4;
const ARROW_HEAD_ANGLE = Math.PI / 7;
const FALLBACK_FONT_FAMILY = "sans-serif";
const APPROX_CHAR_WIDTH = 0.6;
export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_FONT_WEIGHT = 600;

export type StrokeBox = { left: number; top: number; width: number; height: number };

export type StrokeBlend = "multiply" | "normal";

function fontFamily(): string {
  if (typeof document === "undefined") return FALLBACK_FONT_FAMILY;
  return getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || FALLBACK_FONT_FAMILY;
}

export function textFont(sizePx: number): string {
  return `${TEXT_FONT_WEIGHT} ${sizePx}px ${fontFamily()}`;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

export function measureTextBlock(text: string, sizePx: number): { width: number; height: number } {
  const lines = text.split("\n");
  if (measureContext === undefined) measureContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  const context = measureContext;
  if (context) context.font = textFont(sizePx);
  const widest = Math.max(0, ...lines.map((line) => (context ? context.measureText(line).width : line.length * sizePx * APPROX_CHAR_WIDTH)));
  return { width: Math.ceil(widest), height: Math.ceil(lines.length * sizePx * TEXT_LINE_HEIGHT) };
}

export function arrowHeadLength(lineWidthPx: number): number {
  return Math.max(ARROW_HEAD_MIN_PX, lineWidthPx * ARROW_HEAD_PER_WIDTH);
}

function tracePolyline(ctx: CanvasRenderingContext2D, points: StrokePoint[], width: number, height: number) {
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x * width, points[i].y * height);
}

function traceArrowHead(ctx: CanvasRenderingContext2D, from: StrokePoint, to: StrokePoint, width: number, height: number) {
  const tipX = to.x * width;
  const tipY = to.y * height;
  const angle = Math.atan2(tipY - from.y * height, tipX - from.x * width);
  const length = arrowHeadLength(ctx.lineWidth);
  ctx.moveTo(tipX - length * Math.cos(angle - ARROW_HEAD_ANGLE), tipY - length * Math.sin(angle - ARROW_HEAD_ANGLE));
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - length * Math.cos(angle + ARROW_HEAD_ANGLE), tipY - length * Math.sin(angle + ARROW_HEAD_ANGLE));
}

function drawText(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, color: string) {
  const sizePx = (stroke.fontSize ?? 0) * width;
  if (!stroke.text || sizePx <= 0) return;
  ctx.font = textFont(sizePx);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  const anchor = stroke.points[0];
  const leading = ((TEXT_LINE_HEIGHT - 1) / 2) * sizePx;
  stroke.text.split("\n").forEach((line, index) => ctx.fillText(line, anchor.x * width, anchor.y * height + leading + index * sizePx * TEXT_LINE_HEIGHT));
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, blend: StrokeBlend = "multiply", color = stroke.color) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = stroke.width * width;
  ctx.strokeStyle = color;
  if (stroke.tool === "highlighter") {
    if (blend === "multiply") ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
  } else if (stroke.opacity !== undefined) {
    ctx.globalAlpha = stroke.opacity;
  }
  if (stroke.tool === "text") {
    drawText(ctx, stroke, width, height, color);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  if (stroke.tool === "rect" || stroke.tool === "ellipse") {
    tracePolyline(ctx, stroke.tool === "rect" ? rectCorners(stroke) : ellipsePoints(stroke), width, height);
    ctx.closePath();
  } else {
    tracePolyline(ctx, stroke.points, width, height);
    if (stroke.tool === "arrow" && stroke.points.length > 1) traceArrowHead(ctx, stroke.points[0], stroke.points[1], width, height);
  }
  ctx.stroke();
  ctx.restore();
}

function rectCorners(stroke: Stroke): StrokePoint[] {
  const [start, end = start] = stroke.points;
  return [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }];
}

export function clampStrokePoint(point: StrokePoint): StrokePoint {
  const clamp = (value: number) => Math.min(1 + STROKE_REACH, Math.max(-STROKE_REACH, value));
  return { x: clamp(point.x), y: clamp(point.y) };
}

export function strokeCanvasBox(strokes: Stroke[], width: number, height: number): StrokeBox {
  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = height;
  for (const stroke of strokes) {
    const bounds = drawingBounds(stroke, { x: width, y: height });
    const pad = CANVAS_MARGIN_PX + (stroke.tool === "arrow" ? arrowHeadLength(stroke.width * width) : 0);
    minX = Math.min(minX, bounds.left - pad);
    minY = Math.min(minY, bounds.top - pad);
    maxX = Math.max(maxX, bounds.right + pad);
    maxY = Math.max(maxY, bounds.bottom + pad);
  }
  const left = Math.floor(minX);
  const top = Math.floor(minY);
  return { left, top, width: Math.max(1, Math.ceil(maxX) - left), height: Math.max(1, Math.ceil(maxY) - top) };
}

export function readableOnDark(color: string): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const value = Number.parseInt(hex[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const linear = channel / 255;
    return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance < 0.18 ? "#ffffff" : color;
}

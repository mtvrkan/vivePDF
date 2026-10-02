import type { Stroke, StrokePoint } from "@/shared/store/presentationStore";

const CANVAS_MARGIN_PX = 2;
const STROKE_REACH = 1;

export type StrokeBox = { left: number; top: number; width: number; height: number };

export type StrokeBlend = "multiply" | "normal";

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, blend: StrokeBlend = "multiply", color = stroke.color) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = stroke.width * width;
  ctx.strokeStyle = color;
  if (stroke.tool === "highlighter") {
    if (blend === "multiply") ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.45;
  }
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
  for (let i = 1; i < stroke.points.length; i += 1) {
    ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height);
  }
  ctx.stroke();
  ctx.restore();
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
    const pad = (stroke.width * width) / 2 + CANVAS_MARGIN_PX;
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x * width - pad);
      minY = Math.min(minY, point.y * height - pad);
      maxX = Math.max(maxX, point.x * width + pad);
      maxY = Math.max(maxY, point.y * height + pad);
    }
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

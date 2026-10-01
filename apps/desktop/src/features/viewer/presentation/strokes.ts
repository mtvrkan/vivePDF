import type { Stroke } from "@/shared/store/presentationStore";

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = stroke.width * width;
  ctx.strokeStyle = stroke.color;
  if (stroke.tool === "highlighter") {
    ctx.globalCompositeOperation = "multiply";
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

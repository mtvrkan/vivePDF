import { useRef } from "react";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import type { PageRect } from "./usePageRects";
import { drawStroke } from "./strokes";

const NO_STROKES: Stroke[] = [];

export function PageDrawingCanvas({ rect }: { rect: PageRect }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = usePresentationStore((state) => state.strokesByPage[rect.pageIndex] ?? NO_STROKES);
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const setCanvasRef = (node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (!node) return;
    node.width = width * dpr;
    node.height = height * dpr;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    strokes.forEach((stroke) => drawStroke(ctx, stroke, width, height));
  };

  return (
    <canvas
      ref={setCanvasRef}
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: rect.left, top: rect.top, width, height }}
      key={`${strokes.length}-${width}-${height}`}
    />
  );
}

export function LiveStrokeCanvas({ rect, stroke }: { rect: PageRect; stroke: Stroke }) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const setCanvasRef = (node: HTMLCanvasElement | null) => {
    if (!node) return;
    node.width = width * dpr;
    node.height = height * dpr;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStroke(ctx, stroke, width, height);
  };

  return (
    <canvas
      ref={setCanvasRef}
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: rect.left, top: rect.top, width, height }}
      key={stroke.points.length}
    />
  );
}

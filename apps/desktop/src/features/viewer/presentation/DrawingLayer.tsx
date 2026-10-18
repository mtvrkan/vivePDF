import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import type { PageRect } from "./usePageRects";
import { drawStroke, strokeCanvasBox } from "./strokes";

const NO_STROKES: Stroke[] = [];

const StrokeCanvas = memo(function StrokeCanvas({ rect, strokes, redrawKey }: { rect: PageRect; strokes: Stroke[]; redrawKey: string | number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const box = useMemo(() => strokeCanvasBox(strokes, width, height), [strokes, width, height]);
  const shape = `${redrawKey}-${width}-${height}-${box.left}-${box.top}-${box.width}-${box.height}`;

  useLayoutEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    node.width = box.width * dpr;
    node.height = box.height * dpr;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, -box.left * dpr, -box.top * dpr);
    ctx.clearRect(box.left, box.top, box.width, box.height);
    strokes.forEach((stroke) => drawStroke(ctx, stroke, width, height));
  }, [strokes, box, width, height, dpr, shape]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: rect.left + box.left, top: rect.top + box.top, width: box.width, height: box.height }}
      key={shape}
    />
  );
});

export function DrawingItems({ rect, items }: { rect: PageRect; items: Stroke[] }) {
  const assets = usePresentationStore((state) => state.drawingAssets);
  return items.map((stroke) => {
    const asset = stroke.asset ? assets[stroke.asset] : undefined;
    const anchor = stroke.points[0];
    if (!asset || !stroke.size || !anchor) return null;
    return (
      <img
        key={stroke.id}
        src={asset.dataUrl}
        alt=""
        aria-hidden
        draggable={false}
        data-presentation-item={stroke.id}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          left: rect.left + anchor.x * rect.width,
          top: rect.top + anchor.y * rect.height,
          width: stroke.size.width * rect.width,
          height: stroke.size.height * rect.height,
          ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}),
        }}
      />
    );
  });
}

export function PageDrawingCanvas({ rect }: { rect: PageRect }) {
  const strokes = usePresentationStore((state) => state.strokesByPage[rect.pageIndex] ?? NO_STROKES);
  const { items, ink } = useMemo(() => {
    const drawings = strokes.filter((stroke) => stroke.tool === "drawing");
    return { items: drawings, ink: drawings.length === 0 ? strokes : strokes.filter((stroke) => stroke.tool !== "drawing") };
  }, [strokes]);
  if (strokes.length === 0) return null;
  return (
    <>
      {items.length > 0 ? <DrawingItems rect={rect} items={items} /> : null}
      {ink.length > 0 ? <StrokeCanvas rect={rect} strokes={ink} redrawKey={ink.length} /> : null}
    </>
  );
}

export function LiveStrokeCanvas({ rect, stroke }: { rect: PageRect; stroke: Stroke }) {
  const strokes = useMemo(() => [stroke], [stroke]);
  return <StrokeCanvas rect={rect} strokes={strokes} redrawKey={stroke.points.length} />;
}

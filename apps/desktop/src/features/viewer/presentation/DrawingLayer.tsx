import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import type { PageRect } from "./usePageRects";
import { drawStroke, strokeCanvasBox } from "./strokes";

const NO_STROKES: Stroke[] = [];

function StrokeCanvas({ rect, strokes, redrawKey }: { rect: PageRect; strokes: Stroke[]; redrawKey: string | number }) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const box = strokeCanvasBox(strokes, width, height);

  const setCanvasRef = (node: HTMLCanvasElement | null) => {
    if (!node) return;
    node.width = box.width * dpr;
    node.height = box.height * dpr;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, -box.left * dpr, -box.top * dpr);
    ctx.clearRect(box.left, box.top, box.width, box.height);
    strokes.forEach((stroke) => drawStroke(ctx, stroke, width, height));
  };

  return (
    <canvas
      ref={setCanvasRef}
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: rect.left + box.left, top: rect.top + box.top, width: box.width, height: box.height }}
      key={`${redrawKey}-${width}-${height}-${box.left}-${box.top}-${box.width}-${box.height}`}
    />
  );
}

export function PageDrawingCanvas({ rect }: { rect: PageRect }) {
  const strokes = usePresentationStore((state) => state.strokesByPage[rect.pageIndex] ?? NO_STROKES);
  if (strokes.length === 0) return null;
  return <StrokeCanvas rect={rect} strokes={strokes} redrawKey={strokes.length} />;
}

export function LiveStrokeCanvas({ rect, stroke }: { rect: PageRect; stroke: Stroke }) {
  return <StrokeCanvas rect={rect} strokes={[stroke]} redrawKey={stroke.points.length} />;
}

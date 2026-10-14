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

function DrawingItems({ rect, items }: { rect: PageRect; items: Stroke[] }) {
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
  if (strokes.length === 0) return null;
  const items = strokes.filter((stroke) => stroke.tool === "drawing");
  const ink = items.length === 0 ? strokes : strokes.filter((stroke) => stroke.tool !== "drawing");
  return (
    <>
      {items.length > 0 ? <DrawingItems rect={rect} items={items} /> : null}
      {ink.length > 0 ? <StrokeCanvas rect={rect} strokes={ink} redrawKey={ink.length} /> : null}
    </>
  );
}

export function LiveStrokeCanvas({ rect, stroke }: { rect: PageRect; stroke: Stroke }) {
  return <StrokeCanvas rect={rect} strokes={[stroke]} redrawKey={stroke.points.length} />;
}

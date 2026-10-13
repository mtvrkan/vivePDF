import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { drawingBounds, drawingExtent, scaleDrawing, type DrawingBounds } from "@/shared/lib/drawingGeometry";
import type { Stroke } from "@/shared/store/presentationStore";
import { cornerPoint, cornerResize, RESIZE_CORNERS, RESIZE_STEP, stepResize, type DrawingResize, type ResizeCorner } from "./drawingResize";
import { arrowHeadLength } from "./strokes";
import type { PageRect } from "./usePageRects";

const FRAME_GAP_PX = 6;

const HANDLE_PLACEMENT: Record<ResizeCorner, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
};

type Drag = { pointerId: number; corner: ResizeCorner; original: Stroke; extent: DrawingBounds; startX: number; startY: number };

type FrameProps = { rect: PageRect; stroke: Stroke; onChange: (stroke: Stroke) => void; onDelete: () => void };

export function DrawingSelectionFrame({ rect, stroke, onChange, onDelete }: FrameProps) {
  const { t } = useTranslation();
  const dragRef = useRef<Drag | null>(null);
  const scale = { x: rect.width, y: rect.height };
  const area = { width: rect.width, height: rect.height };
  const bounds = drawingBounds(stroke, scale);
  const gap = FRAME_GAP_PX + (stroke.tool === "arrow" ? arrowHeadLength(stroke.width * rect.width) / 2 : 0);
  const left = rect.left + bounds.left - gap;
  const top = rect.top + bounds.top - gap;
  const keepsRatio = stroke.tool === "text";

  const apply = (original: Stroke, resize: DrawingResize | null) => {
    if (!resize) return;
    onChange(scaleDrawing(original, { x: resize.anchor.x / rect.width, y: resize.anchor.y / rect.height }, resize.sx, resize.sy));
  };

  const startDrag = (corner: ResizeCorner) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, corner, original: stroke, extent: drawingExtent(stroke, scale), startX: event.clientX, startY: event.clientY };
  };

  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const start = cornerPoint(current.extent, current.corner);
    const pointer = { x: start.x + event.clientX - current.startX, y: start.y + event.clientY - current.startY };
    apply(current.original, cornerResize(current.extent, current.corner, pointer, keepsRatio || event.shiftKey, area));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
  };

  const step = (factor: number) => apply(stroke, stepResize(drawingExtent(stroke, scale), factor, area));

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        data-presentation-selection=""
        className="absolute rounded-md outline-dashed outline-1 outline-primary"
        style={{ left, top, width: bounds.right - bounds.left + gap * 2, height: bounds.bottom - bounds.top + gap * 2 }}
      >
        {RESIZE_CORNERS.map((corner) => (
          <div
            key={corner}
            data-resize-handle={corner}
            title={t("presentation.resizeHint")}
            aria-hidden
            onPointerDown={startDrag(corner)}
            onPointerMove={drag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={cn("pointer-events-auto absolute flex size-6 touch-none items-center justify-center", HANDLE_PLACEMENT[corner])}
          >
            <span className="size-2.5 rounded-sm border border-primary bg-card shadow-sm" />
          </div>
        ))}
        <div className="glass pointer-events-auto absolute -top-2 right-0 flex -translate-y-full items-center gap-0.5 rounded-xl p-0.5" onPointerDown={(event) => event.stopPropagation()}>
          <IconButton icon={Minus} label={t("presentation.shrinkDrawing")} onClick={() => step(1 / RESIZE_STEP)} />
          <IconButton icon={Plus} label={t("presentation.growDrawing")} onClick={() => step(RESIZE_STEP)} />
          <IconButton icon={Trash2} label={t("presentation.deleteDrawing")} shortcut="Del" onClick={onDelete} />
        </div>
      </div>
    </div>
  );
}

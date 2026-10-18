import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, Minus, Palette, Pencil, Plus, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { useOutsideDismiss } from "@/shared/hooks/useOutsideDismiss";
import { cn } from "@/shared/lib/cn";
import { shortcutLetter } from "@/shared/lib/shortcutKeys";
import { isTextEntryTarget } from "@/shared/lib/typingTarget";
import { drawingBounds, drawingExtent, isBoxed, scaleDrawing, type DrawingBounds } from "@/shared/lib/drawingGeometry";
import { HIGHLIGHTER_WIDTH_RANGE, OPACITY_RANGE, PEN_WIDTH_RANGE, type Stroke } from "@/shared/store/presentationStore";
import { cornerPoint, cornerResize, RESIZE_CORNERS, RESIZE_STEP, stepResize, type DrawingResize, type ResizeCorner } from "./drawingResize";
import { canRotate, QUARTER_TURN, rotateDrawing, snapAngle } from "./drawingRotate";
import { ColorRow, RangeRow } from "./PresentationTools";
import { hasOpenModal } from "../viewerKeyTarget";
import { arrowHeadLength } from "./strokes";
import { PEN_COLORS } from "./toolPresets";
import type { PageRect } from "./usePageRects";

const FRAME_GAP_PX = 6;
const STYLE_PANEL_ROOM_PX = 240;
const PERCENT = 100;

const HANDLE_PLACEMENT: Record<ResizeCorner, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
};

type Drag = { pointerId: number; corner: ResizeCorner; original: Stroke; extent: DrawingBounds; startX: number; startY: number };
type Spin = { pointerId: number; original: Stroke; centreX: number; centreY: number; startAngle: number };

type FrameProps = { rect: PageRect; stroke: Stroke; onChange: (stroke: Stroke) => void; onDelete: () => void; onDuplicate: () => void; onEdit?: () => void };

const clampTo = ([min, max]: readonly [number, number], value: number) => Math.min(max, Math.max(min, value));

function DrawingStylePanel({ rect, stroke, onChange }: { rect: PageRect; stroke: Stroke; onChange: (stroke: Stroke) => void }) {
  const { t } = useTranslation();
  const highlighter = stroke.tool === "highlighter";
  const widthRange = highlighter ? HIGHLIGHTER_WIDTH_RANGE : PEN_WIDTH_RANGE;
  const widthPx = clampTo(widthRange, Math.round(stroke.width * rect.width));
  return (
    <div className="w-56">
      <p className="font-mono text-2xs uppercase tracking-[0.08em] text-muted-foreground">{t("presentation.style")}</p>
      <ColorRow colors={PEN_COLORS} current={stroke.color} onPick={(color) => onChange({ ...stroke, color })} custom />
      {stroke.tool === "text" ? null : (
        <RangeRow label={t("presentation.thickness")} range={widthRange} step={1} value={widthPx} format={(value) => `${value} px`} onChange={(value) => onChange({ ...stroke, width: value / rect.width })} />
      )}
      {highlighter ? null : (
        <RangeRow
          label={t("presentation.opacity")}
          range={OPACITY_RANGE}
          step={0.05}
          value={stroke.opacity ?? 1}
          format={(value) => `${Math.round(value * PERCENT)}%`}
          onChange={(value) => onChange({ ...stroke, opacity: value < 1 ? value : undefined })}
        />
      )}
    </div>
  );
}

export function DrawingSelectionFrame({ rect, stroke, onChange, onDelete, onDuplicate, onEdit }: FrameProps) {
  const { t } = useTranslation();
  const dragRef = useRef<Drag | null>(null);
  const spinRef = useRef<Spin | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  useOutsideDismiss(styleOpen, [toolbarRef], () => setStyleOpen(false));
  const scale = { x: rect.width, y: rect.height };
  const area = { width: rect.width, height: rect.height };
  const bounds = drawingBounds(stroke, scale);
  const gap = FRAME_GAP_PX + (stroke.tool === "arrow" ? arrowHeadLength(stroke.width * rect.width) / 2 : 0);
  const left = rect.left + bounds.left - gap;
  const top = rect.top + bounds.top - gap;
  const keepsRatio = isBoxed(stroke);
  const rotatable = canRotate(stroke);
  const panelAbove = top > STYLE_PANEL_ROOM_PX;

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

  const startSpin = (event: ReactPointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const centreX = frame.left + frame.width / 2;
    const centreY = frame.top + frame.height / 2;
    spinRef.current = { pointerId: event.pointerId, original: stroke, centreX, centreY, startAngle: Math.atan2(event.clientY - centreY, event.clientX - centreX) };
  };

  const spin = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = spinRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const angle = Math.atan2(event.clientY - current.centreY, event.clientX - current.centreX) - current.startAngle;
    onChange(rotateDrawing(current.original, event.shiftKey ? snapAngle(angle) : angle, scale));
  };

  const endSpin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (spinRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    spinRef.current = null;
  };

  const step = (factor: number) => apply(stroke, stepResize(drawingExtent(stroke, scale), factor, area));

  const keys = useRef({ stroke, scale, rotatable, onChange, onDuplicate });
  keys.current = { stroke, scale, rotatable, onChange, onDuplicate };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.defaultPrevented || isTextEntryTarget(event.target) || hasOpenModal()) return;
      const letter = shortcutLetter(event);
      const modifier = event.ctrlKey || event.metaKey;
      const current = keys.current;
      if (modifier && !event.shiftKey && letter === "d") {
        event.preventDefault();
        current.onDuplicate();
      } else if (!modifier && letter === "r" && current.rotatable) {
        event.preventDefault();
        current.onChange(rotateDrawing(current.stroke, event.shiftKey ? -QUARTER_TURN : QUARTER_TURN, current.scale));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        ref={frameRef}
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
        {rotatable ? (
          <div
            data-rotate-handle=""
            title={t("presentation.rotateHint")}
            aria-hidden
            onPointerDown={startSpin}
            onPointerMove={spin}
            onPointerUp={endSpin}
            onPointerCancel={endSpin}
            className="pointer-events-auto absolute left-1/2 top-full flex -translate-x-1/2 cursor-grab touch-none flex-col items-center active:cursor-grabbing"
          >
            <span className="h-3 w-px bg-primary" />
            <span className="flex size-6 items-center justify-center rounded-full border border-primary bg-card shadow-sm">
              <RotateCw className="size-3 text-primary" />
            </span>
          </div>
        ) : null}
        <div ref={toolbarRef} className="glass pointer-events-auto absolute -top-2 right-0 flex -translate-y-full items-center gap-0.5 rounded-xl p-0.5" onPointerDown={(event) => event.stopPropagation()}>
          {rotatable ? (
            <>
              <IconButton icon={RotateCcw} label={t("presentation.rotateLeft")} shortcut="Shift+R" onClick={() => onChange(rotateDrawing(stroke, -QUARTER_TURN, scale))} />
              <IconButton icon={RotateCw} label={t("presentation.rotateRight")} shortcut="R" onClick={() => onChange(rotateDrawing(stroke, QUARTER_TURN, scale))} />
            </>
          ) : null}
          {stroke.tool === "drawing" ? (
            onEdit ? <IconButton icon={Pencil} label={t("presentation.insert.edit")} onClick={onEdit} /> : null
          ) : (
            <IconButton icon={Palette} label={t("presentation.style")} active={styleOpen} onClick={() => setStyleOpen((open) => !open)} />
          )}
          <IconButton icon={Copy} label={t("presentation.duplicateDrawing")} shortcut="Ctrl+D" onClick={onDuplicate} />
          <IconButton icon={Minus} label={t("presentation.shrinkDrawing")} onClick={() => step(1 / RESIZE_STEP)} />
          <IconButton icon={Plus} label={t("presentation.growDrawing")} onClick={() => step(RESIZE_STEP)} />
          <IconButton icon={Trash2} label={t("presentation.deleteDrawing")} shortcut="Del" onClick={onDelete} />
          {styleOpen ? (
            <div
              data-drawing-style=""
              className={cn("glass select-pop absolute right-0 rounded-2xl p-3", panelAbove ? "bottom-full mb-2 origin-bottom-right" : "top-full mt-2 origin-top-right")}
            >
              <DrawingStylePanel rect={rect} stroke={stroke} onChange={onChange} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

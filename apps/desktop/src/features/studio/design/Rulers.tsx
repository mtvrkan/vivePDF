import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { rulerTicks, type RulerTick } from "./rulerTicks";
import type { Axis } from "./snapping";

const SIZE = 24;
const LABEL_BASELINE = 12;
const TICK_LENGTH: Record<RulerTick["kind"], number> = { major: SIZE, mid: 8, minor: 4 };

type Frame = { x: number; y: number; width: number; height: number };
export type RulerExtent = { x: [number, number]; y: [number, number] } | null;
export type RulerHandlers = {
  onPointerDown: (axis: Axis, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onDoubleClick: (axis: Axis, event: ReactMouseEvent<HTMLDivElement>) => void;
};

function sameFrame(left: Frame, right: Frame): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function Ruler({ axis, origin, length, zoom, extent, language, handlers }: { axis: Axis; origin: number; length: number; zoom: number; extent: [number, number] | null; language: string; handlers: RulerHandlers }) {
  const { t } = useTranslation();
  const ticks = useMemo(() => rulerTicks(origin, length, zoom), [origin, length, zoom]);
  const number = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }), [language]);
  const horizontal = axis === "x";
  const path = ticks
    .map((tick) => {
      const at = Math.round(tick.offset) + 0.5;
      return horizontal ? `M${at} ${SIZE}V${SIZE - TICK_LENGTH[tick.kind]}` : `M${SIZE} ${at}H${SIZE - TICK_LENGTH[tick.kind]}`;
    })
    .join("");
  const band = extent ? { from: origin + extent[0] * zoom, to: origin + extent[1] * zoom } : null;
  return (
    <div
      data-ruler={axis}
      data-testid={`studio-ruler-${axis}`}
      title={t("studio.view.rulerHint")}
      className={
        horizontal
          ? "absolute left-6 right-0 top-0 h-6 cursor-row-resize touch-none select-none overflow-hidden border-b border-border bg-background text-muted-foreground"
          : "absolute bottom-0 left-0 top-6 w-6 cursor-col-resize touch-none select-none overflow-hidden border-r border-border bg-background text-muted-foreground"
      }
      onPointerDown={(event) => handlers.onPointerDown(axis, event)}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerUp}
      onDoubleClick={(event) => handlers.onDoubleClick(axis, event)}
    >
      <svg aria-hidden width={horizontal ? length : SIZE} height={horizontal ? SIZE : length} className="block">
        {band ? (horizontal ? <rect x={band.from} y={0} width={Math.max(1, band.to - band.from)} height={SIZE} className="fill-primary/15" /> : <rect x={0} y={band.from} width={SIZE} height={Math.max(1, band.to - band.from)} className="fill-primary/15" />) : null}
        <path d={path} stroke="currentColor" strokeWidth={1} shapeRendering="crispEdges" fill="none" />
        {ticks
          .filter((tick) => tick.kind === "major")
          .map((tick) => {
            const at = Math.round(tick.offset);
            return horizontal ? (
              <text key={tick.value} x={at + 3} y={LABEL_BASELINE} className="fill-current text-xs tabular-nums">
                {number.format(tick.value)}
              </text>
            ) : (
              <text key={tick.value} transform={`translate(${LABEL_BASELINE} ${at + 3}) rotate(-90)`} textAnchor="end" className="fill-current text-xs tabular-nums">
                {number.format(tick.value)}
              </text>
            );
          })}
      </svg>
    </div>
  );
}

export function CanvasRulers({ viewportRef, pageRef, zoom, pageWidth, pageHeight, extent, language, handlers }: { viewportRef: RefObject<HTMLDivElement | null>; pageRef: RefObject<HTMLDivElement | null>; zoom: number; pageWidth: number; pageHeight: number; extent: RulerExtent; language: string; handlers: RulerHandlers }) {
  const [frame, setFrame] = useState<Frame>({ x: 0, y: 0, width: 0, height: 0 });
  const sync = useCallback(() => {
    const viewport = viewportRef.current;
    const host = pageRef.current;
    if (!viewport || !host) return;
    const view = viewport.getBoundingClientRect();
    const rect = host.getBoundingClientRect();
    const next = { x: rect.left - view.left, y: rect.top - view.top, width: viewport.clientWidth, height: viewport.clientHeight };
    setFrame((current) => (sameFrame(current, next) ? current : next));
  }, [viewportRef, pageRef]);

  useLayoutEffect(() => {
    sync();
  }, [sync, zoom, pageWidth, pageHeight]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let pending = 0;
    const schedule = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(sync);
    };
    viewport.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(pending);
      viewport.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [viewportRef, sync]);

  return (
    <>
      <div aria-hidden className="absolute left-0 top-0 size-6 border-b border-r border-border bg-background" />
      <Ruler axis="x" origin={frame.x} length={frame.width} zoom={zoom} extent={extent?.x ?? null} language={language} handlers={handlers} />
      <Ruler axis="y" origin={frame.y} length={frame.height} zoom={zoom} extent={extent?.y ?? null} language={language} handlers={handlers} />
    </>
  );
}

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { cn } from "@/shared/lib/cn";
import type { DocumentSettings } from "@/types/studio";
import { useDocumentStore } from "./documentStore";
import { contentInsets, POINTS_PER_MM } from "./model";
import type { PageLine } from "./pageBreaks";
import { draggedIndents, draggedMargin, indentsPatch, PX_PER_PT, rulerTicks, snapToMillimetre, type IndentMarker, type MarginSide, type Tick } from "./ruler";
import { useRulerFrame } from "./rulerFrame";
import type { LaidOut } from "./useDocumentLayout";

const BAND = 24;
const STEP_MM = 1;
const FAR_STEP_MM = 5;

type Size = { width: number; height: number };
type Guide = { axis: "x" | "y"; at: number } | null;
type RulerProps = { editor: Editor; settings: DocumentSettings; size: Size; paper: RefObject<HTMLDivElement | null>; host: RefObject<HTMLDivElement | null> };

function TickMarks({ ticks, scale, vertical }: { ticks: Tick[]; scale: number; vertical?: boolean }) {
  const middle = BAND / 2;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-2xs text-muted-foreground" aria-hidden>
      {ticks.map((tick) => {
        const at = tick.at * scale;
        if (tick.label !== null) {
          return (
            <text key={tick.at} x={vertical ? middle : at} y={vertical ? at : middle} textAnchor="middle" dominantBaseline="central" className="fill-current">
              {tick.label}
            </text>
          );
        }
        const reach = tick.kind === "half" ? 4 : 2;
        return vertical ? (
          <line key={tick.at} x1={middle - reach} x2={middle + reach} y1={at} y2={at} stroke="currentColor" />
        ) : (
          <line key={tick.at} x1={at} x2={at} y1={middle - reach} y2={middle + reach} stroke="currentColor" />
        );
      })}
    </svg>
  );
}

function GuideLine({ guide, paper }: { guide: Guide; paper: HTMLElement | null }) {
  if (!guide || !paper) return null;
  const style = guide.axis === "x" ? { left: `${guide.at}pt` } : { top: `${guide.at}pt` };
  return createPortal(
    <span className={cn("pointer-events-none absolute border-dashed border-primary", guide.axis === "x" ? "inset-y-0 border-l" : "inset-x-0 border-t")} style={style} data-testid="document-ruler-guide" aria-hidden />,
    paper,
  );
}

function useDrag(onMove: (event: PointerEvent<HTMLElement>) => void, onEnd: () => void) {
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.currentTarget.focus();
      onMove(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) onMove(event);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      onEnd();
    },
    onPointerCancel: onEnd,
  };
}

function Handle({
  label,
  valueMm,
  maxMm,
  vertical,
  style,
  className,
  testId,
  children,
  onMove,
  onEnd,
  onStep,
}: {
  label: string;
  valueMm: number;
  maxMm: number;
  vertical?: boolean;
  style: CSSProperties;
  className: string;
  testId: string;
  children?: ReactNode;
  onMove: (event: PointerEvent<HTMLElement>) => void;
  onEnd: () => void;
  onStep: (millimetres: number) => void;
}) {
  const { t } = useTranslation();
  const drag = useDrag(onMove, onEnd);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    if (event.key !== forward && event.key !== back) return;
    event.preventDefault();
    const step = event.shiftKey ? FAR_STEP_MM : STEP_MM;
    onStep(event.key === forward ? step : -step);
  };
  const rounded = Math.round(valueMm * 10) / 10;
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      title={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={Math.round(maxMm)}
      aria-valuenow={rounded}
      aria-valuetext={t("studio.doc.ruler.value", { value: rounded })}
      data-testid={testId}
      onKeyDown={onKeyDown}
      onBlur={onEnd}
      {...drag}
      className={cn("absolute touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      style={style}
    >
      {children}
    </div>
  );
}

const MARKER_SHAPES: Record<IndentMarker, string> = {
  firstLine: "M1 1 H9 L5 6 Z",
  hanging: "M5 1 L9 6 H1 Z",
  left: "M1 1 H9 V5 H1 Z",
  right: "M5 1 L9 6 H1 Z",
};
const MARKER_TOPS: Record<IndentMarker, number> = { firstLine: 1, hanging: 9, left: 17, right: 9 };

export function HorizontalRuler({ editor, settings, size, paper, host }: RulerProps) {
  const { t } = useTranslation();
  const own = useRef<HTMLDivElement>(null);
  const frame = useRulerFrame(editor, paper, host, own, size.width);
  const [guide, setGuide] = useState<Guide>(null);
  const inset = contentInsets(settings);
  const end = () => setGuide(null);
  const scale = frame?.scale ?? 0;
  const block = frame?.block ?? null;
  const pointAt = (clientX: number, from: number) => (clientX - (own.current?.getBoundingClientRect().left ?? 0) - from) / scale;

  const setMargin = (side: MarginSide, at: number, guided = true) => {
    useDocumentStore.getState().setSettings(draggedMargin(side, settings, at, size));
    if (guided) setGuide({ axis: "x", at: snapToMillimetre(at) });
  };
  const marginAt = (side: "left" | "right") => (side === "left" ? inset.left : size.width - inset.right);

  const setIndent = (marker: IndentMarker, at: number, guided = true) => {
    if (!block) return;
    const next = draggedIndents(marker, block.indents, snapToMillimetre(at), block.width / scale);
    editor.chain().setSpacing(indentsPatch(next)).run();
    const position = marker === "right" ? block.width / scale - next.right : marker === "firstLine" ? next.left + next.firstLine : next.left;
    if (guided) setGuide({ axis: "x", at: (block.left - (frame?.paperX ?? 0)) / scale + position });
  };
  const markerAt = (marker: IndentMarker) => {
    if (!block) return 0;
    const { left, right, firstLine } = block.indents;
    return marker === "right" ? block.width / scale - right : marker === "firstLine" ? left + firstLine : left;
  };

  return (
    <div ref={own} dir="ltr" role="group" aria-label={t("studio.doc.ruler.horizontal")} className="relative order-first h-6 shrink-0 select-none overflow-hidden border-b border-border bg-background" data-testid="document-ruler">
      {frame ? (
        <div className="absolute inset-y-0 bg-card" style={{ left: frame.paperX, width: size.width * scale }}>
          <div className="absolute inset-0 bg-muted-foreground/20" />
          <div className="absolute inset-y-0 bg-card" style={{ left: inset.left * scale, right: inset.right * scale }} />
          <TickMarks ticks={rulerTicks(size.width, inset.left)} scale={scale} />
          {(["left", "right"] as const).map((side) => (
            <Handle
              key={side}
              label={t(`studio.doc.ruler.margins.${side}`)}
              valueMm={side === "left" ? settings.marginLeftMm : settings.marginRightMm}
              maxMm={size.width / POINTS_PER_MM}
              style={{ left: marginAt(side) * scale - 3 }}
              className="inset-y-0 w-1.5 cursor-col-resize hover:bg-primary/30"
              testId={`ruler-margin-${side}`}
              onMove={(event) => setMargin(side, pointAt(event.clientX, frame.paperX))}
              onEnd={end}
              onStep={(millimetres) => setMargin(side, marginAt(side) + millimetres * POINTS_PER_MM, false)}
            />
          ))}
        </div>
      ) : null}
      {frame && block
        ? (["firstLine", "hanging", "left", "right"] as const).map((marker) => {
            const at = markerAt(marker);
            const indents = block.indents;
            const valueMm = (marker === "right" ? indents.right : marker === "firstLine" ? indents.left + indents.firstLine : indents.left) / POINTS_PER_MM;
            return (
              <Handle
                key={marker}
                label={t(`studio.doc.ruler.indents.${marker}`)}
                valueMm={valueMm}
                maxMm={block.width / scale / POINTS_PER_MM}
                style={{ left: block.left + at * scale - 5, top: MARKER_TOPS[marker] }}
                className={cn("w-2.5 cursor-ew-resize", marker === "left" ? "h-1.5" : "h-2")}
                testId={`ruler-indent-${marker}`}
                onMove={(event) => setIndent(marker, pointAt(event.clientX, block.left))}
                onEnd={end}
                onStep={(millimetres) => setIndent(marker, at + millimetres * POINTS_PER_MM, false)}
              >
                <svg viewBox="0 0 10 7" className="pointer-events-none block h-full w-full overflow-visible fill-card stroke-foreground/70" aria-hidden>
                  <path d={MARKER_SHAPES[marker]} strokeWidth={1} />
                </svg>
              </Handle>
            );
          })
        : null}
      <GuideLine guide={guide} paper={paper.current} />
    </div>
  );
}

export function VerticalRuler({ editor, settings, size, paper, host, laid, lines, zoom }: RulerProps & { laid: LaidOut | null; lines: PageLine[] | null; zoom: number }) {
  const { t } = useTranslation();
  const own = useRef<HTMLDivElement>(null);
  const frame = useRulerFrame(editor, paper, host, own, size.width, { laid, lines, zoom });
  const [guide, setGuide] = useState<Guide>(null);
  const inset = contentInsets(settings);
  const scale = frame?.scale ?? 0;
  const line = frame?.page && lines ? lines.find((candidate) => candidate.page === frame.page) : undefined;
  const pageTop = line ? Math.max(0, line.y / PX_PER_PT - inset.top) : 0;
  const top = (frame?.paperY ?? 0) + pageTop * scale;
  const end = () => setGuide(null);
  const setMargin = (side: MarginSide, at: number, guided = true) => {
    useDocumentStore.getState().setSettings(draggedMargin(side, settings, at, size));
    if (guided) setGuide({ axis: "y", at: pageTop + snapToMillimetre(at) });
  };
  const marginAt = (side: "top" | "bottom") => (side === "top" ? inset.top : size.height - inset.bottom);
  const pointAt = (clientY: number) => (clientY - (own.current?.getBoundingClientRect().top ?? 0) - top) / scale;

  return (
    <div ref={own} dir="ltr" role="group" aria-label={t("studio.doc.ruler.vertical")} className="relative order-first w-6 shrink-0 select-none overflow-hidden border-r border-border bg-background" data-testid="document-ruler-vertical">
      {frame ? (
        <div className="absolute inset-x-0 bg-card" style={{ top, height: size.height * scale }}>
          <div className="absolute inset-0 bg-muted-foreground/20" />
          <div className="absolute inset-x-0 bg-card" style={{ top: inset.top * scale, bottom: inset.bottom * scale }} />
          <TickMarks ticks={rulerTicks(size.height, inset.top)} scale={scale} vertical />
          {(["top", "bottom"] as const).map((side) => (
            <Handle
              key={side}
              vertical
              label={t(`studio.doc.ruler.margins.${side}`)}
              valueMm={side === "top" ? settings.marginTopMm : settings.marginBottomMm}
              maxMm={size.height / POINTS_PER_MM}
              style={{ top: marginAt(side) * scale - 3 }}
              className="inset-x-0 h-1.5 cursor-row-resize hover:bg-primary/30"
              testId={`ruler-margin-${side}`}
              onMove={(event) => setMargin(side, pointAt(event.clientY))}
              onEnd={end}
              onStep={(millimetres) => setMargin(side, marginAt(side) + millimetres * POINTS_PER_MM, false)}
            />
          ))}
        </div>
      ) : null}
      <GuideLine guide={guide} paper={paper.current} />
    </div>
  );
}

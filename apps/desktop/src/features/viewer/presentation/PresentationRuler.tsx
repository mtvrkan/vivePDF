import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, RotateCw, X } from "lucide-react";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore, type RulerState } from "@/shared/store/presentationStore";
import { rotateRuler, rulerEdge, snapAngle, type RulerEdge } from "./ruler";
import type { PageRect } from "./usePageRects";

const MM_PER_CM = 10;
const MIN_MM_TICK_PX = 3;
const MIN_LABEL_GAP_PX = 22;
const KEY_STEP = 0.005;
const KEY_STEP_LARGE = 0.05;
const ROTATE_STEP_DEG = 15;
const HANDLE_SIZE_PX = 24;
const KEY_MOVES: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

type Drag = { kind: "move" | "rotate"; pointerId: number; x: number; y: number; ruler: RulerState; rect: PageRect };

function tickPaths(edge: RulerEdge): { cm: string; half: string; mm: string; labels: number[] } {
  const showMm = edge.pxPerCm / MM_PER_CM >= MIN_MM_TICK_PX;
  const labelEvery = [1, 2, 5, 10].find((step) => step * edge.pxPerCm >= MIN_LABEL_GAP_PX) ?? 10;
  let cm = "";
  let half = "";
  let mm = "";
  const labels: number[] = [];
  for (let tenth = 0; tenth <= edge.lengthCm * MM_PER_CM; tenth += 1) {
    const x = (tenth / MM_PER_CM) * edge.pxPerCm;
    if (tenth % MM_PER_CM === 0) {
      cm += `M${x} 0V${edge.band * 0.42}`;
      if ((tenth / MM_PER_CM) % labelEvery === 0) labels.push(tenth / MM_PER_CM);
    } else if (tenth % (MM_PER_CM / 2) === 0) half += `M${x} 0V${edge.band * 0.3}`;
    else if (showMm) mm += `M${x} 0V${edge.band * 0.18}`;
  }
  return { cm, half, mm, labels };
}

export function PresentationRuler({ rects, interactive = false }: { rects: PageRect[]; interactive?: boolean }) {
  const { t, i18n } = useTranslation();
  const ruler = usePresentationStore((state) => state.ruler);
  const setRuler = usePresentationStore((state) => state.setRuler);
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const edge = rulerEdge(rects, ruler);
  if (!ruler || !edge) return null;

  const ticks = tickPaths(edge);
  const number = new Intl.NumberFormat(i18n.language);
  const angleText = `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(edge.angle)}°`;
  const fontPx = edge.band * 0.24;

  const begin = (kind: Drag["kind"]) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const rect = rects.find((entry) => entry.pageIndex === ruler.pageIndex);
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ruler, rect };
  };

  const onMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "move") {
      setRuler({ ...drag.ruler, x: drag.ruler.x + (event.clientX - drag.x) / drag.rect.width, y: drag.ruler.y + (event.clientY - drag.y) / drag.rect.height });
      return;
    }
    const layer = layerRef.current?.getBoundingClientRect();
    const originX = (layer?.left ?? 0) + drag.rect.left + drag.ruler.x * drag.rect.width;
    const originY = (layer?.top ?? 0) + drag.rect.top + drag.ruler.y * drag.rect.height;
    const angle = (Math.atan2(event.clientY - originY, event.clientX - originX) * 180) / Math.PI;
    setRuler({ ...drag.ruler, angle: snapAngle(angle, event.shiftKey) });
  };

  const onEnd = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = KEY_MOVES[event.key];
    if (!move || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    setRuler({ ...ruler, x: ruler.x + move[0] * step, y: ruler.y + move[1] * step });
  };

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-30 overflow-hidden" data-presentation-ruler="">
      <div
        dir="ltr"
        className="absolute"
        style={{ left: edge.origin.x, top: edge.origin.y, width: edge.length, height: edge.band, transform: `rotate(${edge.angle}deg)`, transformOrigin: "0 0" }}
      >
        <div
          role={interactive ? "group" : undefined}
          aria-label={interactive ? t("presentation.ruler.label") : undefined}
          aria-hidden={interactive ? undefined : true}
          tabIndex={interactive ? 0 : undefined}
          title={interactive ? t("presentation.ruler.moveHint") : undefined}
          onPointerDown={interactive ? begin("move") : undefined}
          onPointerMove={interactive ? onMove : undefined}
          onPointerUp={interactive ? onEnd : undefined}
          onPointerCancel={interactive ? onEnd : undefined}
          onKeyDown={interactive ? onKeyDown : undefined}
          className={cn(
            "absolute inset-0 rounded-b-md border border-border bg-background/80 text-foreground shadow-md backdrop-blur-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            interactive && "pointer-events-auto cursor-move touch-none",
          )}
        >
          <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <path d={ticks.cm} stroke="currentColor" strokeWidth={1.2} />
            <path d={ticks.half} stroke="currentColor" strokeWidth={1} />
            {ticks.mm ? <path d={ticks.mm} stroke="currentColor" strokeWidth={0.7} opacity={0.75} /> : null}
            {ticks.labels.map((value) => (
              <text key={value} x={value * edge.pxPerCm} y={edge.band * 0.42 + fontPx} fontSize={fontPx} textAnchor="middle" fill="currentColor" className="font-mono tabular-nums">
                {number.format(value)}
              </text>
            ))}
          </svg>
          <span className="absolute bottom-1 right-10 font-mono text-[10px] tabular-nums text-muted-foreground" data-ruler-angle="">
            {angleText}
          </span>
          {interactive ? (
            <span
              aria-hidden
              data-ruler-rotate=""
              title={t("presentation.ruler.rotateHint")}
              onPointerDown={begin("rotate")}
              onPointerMove={onMove}
              onPointerUp={onEnd}
              onPointerCancel={onEnd}
              className="absolute right-1.5 top-1/2 flex -translate-y-1/2 cursor-grab items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
              style={{ width: HANDLE_SIZE_PX, height: HANDLE_SIZE_PX }}
            >
              <RotateCw className="size-3.5" />
            </span>
          ) : null}
        </div>
        {interactive ? (
          <div className="glass pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-1.5 py-1" style={{ top: edge.band + 8 }}>
            <IconButton icon={RotateCcw} label={t("presentation.ruler.rotateLeft")} onClick={() => setRuler(rotateRuler(ruler, -ROTATE_STEP_DEG))} />
            <IconButton icon={RotateCw} label={t("presentation.ruler.rotateRight")} onClick={() => setRuler(rotateRuler(ruler, ROTATE_STEP_DEG))} />
            <IconButton icon={X} label={t("presentation.ruler.hide")} onClick={() => setRuler(null)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

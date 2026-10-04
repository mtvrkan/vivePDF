import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { StudioVectorPath } from "@/types/studio";
import type { IconEntry } from "./iconSearch";

const OVERSCAN = 3;

export function IconGlyph({ paths, className }: { paths: StudioVectorPath[]; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths.map((path, index) => (
        <path key={index} d={path.d} fill={path.fill.type === "solid" ? "currentColor" : "none"} strokeWidth={path.stroke?.width ?? 0} />
      ))}
    </svg>
  );
}

type IconGridProps = {
  entries: readonly IconEntry[];
  preview: (name: string) => StudioVectorPath[];
  onPick: (entry: IconEntry) => void;
  labelOf: (entry: IconEntry) => string;
  ariaLabel: string;
  tile: number;
  columns?: number;
  height?: number;
  showLabels?: boolean;
  gap?: number;
};

export function IconGrid({ entries, preview, onPick, labelOf, ariaLabel, tile, columns: fixedColumns, height, showLabels = false, gap = 8 }: IconGridProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [active, setActive] = useState(0);
  const focusPending = useRef(false);
  const virtual = height !== undefined;

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (fixedColumns || !element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [fixedColumns]);

  useEffect(() => {
    setActive(0);
    if (scrollerRef.current && virtual) scrollerRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [entries, virtual]);

  const columns = fixedColumns ?? Math.max(1, Math.floor((width + gap) / (tile + gap)) || 1);
  const rowHeight = tile + gap;
  const rows = Math.ceil(entries.length / columns);
  const firstRow = virtual ? Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN) : 0;
  const lastRow = virtual ? Math.min(rows, Math.ceil((scrollTop + (height ?? 0)) / rowHeight) + OVERSCAN) : rows;
  const firstIndex = firstRow * columns;
  const visible = entries.slice(firstIndex, lastRow * columns);
  const current = Math.min(active, Math.max(0, entries.length - 1));
  const tabbable = current >= firstIndex && current < firstIndex + visible.length ? current : firstIndex;

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    scrollerRef.current?.querySelector<HTMLButtonElement>(`[data-icon-index="${current}"]`)?.focus();
  });

  const reveal = (index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || !virtual || height === undefined) return;
    const top = Math.floor(index / columns) * rowHeight;
    let next = scroller.scrollTop;
    if (top < next) next = top;
    else if (top + rowHeight > next + height) next = top + rowHeight - height;
    if (next !== scroller.scrollTop) {
      scroller.scrollTop = next;
      setScrollTop(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Number((event.target as HTMLElement).dataset.iconIndex);
    if (!Number.isInteger(index) || !entries.length) return;
    const rtl = scrollerRef.current ? getComputedStyle(scrollerRef.current).direction === "rtl" : false;
    const pageRows = Math.max(1, Math.floor((height ?? rowHeight * 3) / rowHeight));
    const rowStart = index - (index % columns);
    const moves: Record<string, number> = {
      ArrowRight: index + (rtl ? -1 : 1),
      ArrowLeft: index + (rtl ? 1 : -1),
      ArrowDown: index + columns,
      ArrowUp: index - columns,
      Home: event.ctrlKey ? 0 : rowStart,
      End: event.ctrlKey ? entries.length - 1 : rowStart + columns - 1,
      PageDown: index + columns * pageRows,
      PageUp: index - columns * pageRows,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = Math.min(entries.length - 1, Math.max(0, moves[event.key]));
    focusPending.current = true;
    reveal(next);
    setActive(next);
  };

  const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: `${tile}px`, gap: `${gap}px` };
  const grid = (
    <div role="group" aria-label={ariaLabel} className="grid" style={virtual ? { ...gridStyle, transform: `translateY(${firstRow * rowHeight}px)` } : gridStyle} onKeyDown={onKeyDown}>
      {visible.map((entry, offset) => {
        const index = firstIndex + offset;
        return (
          <button
            key={entry.name}
            type="button"
            data-icon-index={index}
            data-icon={entry.name}
            tabIndex={index === tabbable ? 0 : -1}
            aria-label={labelOf(entry)}
            title={entry.label}
            onFocus={() => setActive(index)}
            onClick={() => onPick(entry)}
            className="card glass-tinted flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-foreground outline-none hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconGlyph paths={preview(entry.name)} className={showLabels ? "size-7 shrink-0" : "size-5 shrink-0"} />
            {showLabels ? <span className="w-full truncate px-1 text-center text-[11px] leading-tight text-muted-foreground">{entry.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
  if (!virtual) return <div ref={scrollerRef}>{grid}</div>;
  return (
    <div ref={scrollerRef} className="overflow-y-auto pe-1" style={{ height: `${height}px` }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} data-testid="studio-icon-scroller">
      <div style={{ height: `${Math.max(0, rows * rowHeight - gap)}px` }}>{grid}</div>
    </div>
  );
}

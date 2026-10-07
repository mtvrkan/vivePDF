import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { dropIndexAt, gridHeight, gridMetrics, indexesNear, mirrorBox, revealOffset, rowStride, rowsRange, sameRowWindow, tileBox, type GridBox, type TileRange } from "./gridGeometry";

export const VIRTUALIZE_FROM = 150;
const OVERSCAN_ROWS = 3;
const REVEAL_MARGIN = 16;

type Frame = { width: number; gap: number; rtl: boolean; top: number; height: number };

type GridSettings = { count: number; minColumnWidth: number; rowHeight: number };

function sameWindow(current: Frame, next: Frame, { count, minColumnWidth, rowHeight }: GridSettings): boolean {
  if (current.width !== next.width || current.gap !== next.gap || current.rtl !== next.rtl || current.height !== next.height) return false;
  if (current.top === next.top || count < VIRTUALIZE_FROM) return true;
  return sameRowWindow(gridMetrics(count, next.width, minColumnWidth, rowHeight, next.gap), current.top, next.top, next.height, OVERSCAN_ROWS);
}

type UseVirtualGridOptions = {
  mounted: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLElement | null>;
  count: number;
  minColumnWidth: number;
  rowHeight: number;
};

export function useVirtualGrid({ mounted, scrollRef, gridRef, count, minColumnWidth, rowHeight }: UseVirtualGridOptions) {
  const [frame, setFrame] = useState<Frame>({ width: 0, gap: 0, rtl: false, top: 0, height: 0 });
  const metrics = useMemo(() => gridMetrics(count, frame.width, minColumnWidth, rowHeight, frame.gap), [count, frame.width, minColumnWidth, rowHeight, frame.gap]);
  const virtualized = count >= VIRTUALIZE_FROM;

  const computed = virtualized ? rowsRange(metrics, frame.top, frame.top + frame.height, OVERSCAN_ROWS) : { start: 0, end: count };
  const range = useMemo<TileRange>(() => ({ start: computed.start, end: computed.end }), [computed.start, computed.end]);

  const latest = useRef({ metrics, rtl: frame.rtl });
  const settings = useRef<GridSettings>({ count, minColumnWidth, rowHeight });
  useLayoutEffect(() => {
    latest.current = { metrics, rtl: frame.rtl };
    settings.current = { count, minColumnWidth, rowHeight };
  });

  const measureFrame = useCallback(() => {
    const container = scrollRef.current;
    const grid = gridRef.current;
    if (!container || !grid) return;
    const style = getComputedStyle(grid);
    const next: Frame = {
      width: grid.clientWidth,
      gap: Number.parseFloat(style.rowGap) || 0,
      rtl: style.direction === "rtl",
      top: container.scrollTop - grid.offsetTop,
      height: container.clientHeight,
    };
    setFrame((current) => (sameWindow(current, next, settings.current) ? current : next));
  }, [scrollRef, gridRef]);

  useLayoutEffect(() => {
    if (!mounted) return;
    measureFrame();
    const container = scrollRef.current;
    const grid = gridRef.current;
    if (!container || !grid) return;
    let frameId: number | null = null;
    const onScroll = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        measureFrame();
      });
    };
    const observer = new ResizeObserver(() => measureFrame());
    observer.observe(container);
    observer.observe(grid);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", onScroll);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [mounted, scrollRef, gridRef, measureFrame]);

  const contentOrigin = useCallback((): { left: number; top: number } | null => {
    const container = scrollRef.current;
    const grid = gridRef.current;
    if (!container || !grid) return null;
    const containerRect = container.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    return { left: gridRect.left - containerRect.left + container.scrollLeft, top: gridRect.top - containerRect.top + container.scrollTop };
  }, [scrollRef, gridRef]);

  const indexBoxesNear = useCallback(
    (box: GridBox): { index: number; box: GridBox }[] => {
      const origin = contentOrigin();
      if (!origin) return [];
      const { metrics: current, rtl } = latest.current;
      const shifted = { ...box, left: box.left - origin.left, top: box.top - origin.top };
      const local = rtl ? mirrorBox(current, shifted) : shifted;
      return indexesNear(current, local).map((index) => {
        const tile = rtl ? mirrorBox(current, tileBox(current, index)) : tileBox(current, index);
        return { index, box: { ...tile, left: tile.left + origin.left, top: tile.top + origin.top } };
      });
    },
    [contentOrigin],
  );

  const dropIndexAtClient = useCallback(
    (clientX: number, clientY: number): number => {
      const grid = gridRef.current;
      const { metrics: current, rtl } = latest.current;
      if (!grid) return current.count;
      const rect = grid.getBoundingClientRect();
      const x = rtl ? rect.right - clientX : clientX - rect.left;
      return dropIndexAt(current, x, clientY - rect.top);
    },
    [gridRef],
  );

  const clientBoxOf = useCallback(
    (index: number): GridBox | null => {
      const grid = gridRef.current;
      const { metrics: current, rtl } = latest.current;
      if (!grid || index < 0 || index >= current.count) return null;
      const rect = grid.getBoundingClientRect();
      const local = rtl ? mirrorBox(current, tileBox(current, index)) : tileBox(current, index);
      return { ...local, left: rect.left + local.left, top: rect.top + local.top };
    },
    [gridRef],
  );

  const revealIndex = useCallback(
    (index: number) => {
      const container = scrollRef.current;
      const grid = gridRef.current;
      const { metrics: current } = latest.current;
      if (!container || !grid || index < 0) return;
      const box = tileBox(current, index);
      const next = revealOffset(container.scrollTop, container.clientHeight, grid.offsetTop + box.top, box.height, REVEAL_MARGIN);
      if (next !== null) container.scrollTop = next;
    },
    [scrollRef, gridRef],
  );

  const columns = useCallback(() => latest.current.metrics.columns, []);

  const stride = rowStride(metrics);
  const renderedRows = Math.ceil((range.end - range.start) / metrics.columns);
  const paddingTop = virtualized ? (range.start / metrics.columns) * stride : 0;
  const renderedHeight = renderedRows > 0 ? renderedRows * stride - metrics.gap : 0;
  const paddingBottom = virtualized ? Math.max(0, gridHeight(metrics) - paddingTop - renderedHeight) : 0;

  return { metrics, range, virtualized, paddingTop, paddingBottom, columns, revealIndex, indexBoxesNear, dropIndexAtClient, clientBoxOf };
}

export type VirtualGrid = ReturnType<typeof useVirtualGrid>;

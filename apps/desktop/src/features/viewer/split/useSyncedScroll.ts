import { useEffect, useRef } from "react";
import { useRegistry } from "@embedpdf/core/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useViewportCapability } from "@embedpdf/plugin-viewport/react";
import { pageOffsetBetween, scrollPositionOf, syncTargetOf } from "./syncMath";

const FOLLOW_QUIET_MS = 150;

type ScrollProvides = NonNullable<ReturnType<typeof useScroll>["provides"]>;
type Side = "primary" | "pane";

function topOfView(scroll: ScrollProvides): { pageNumber: number; x: number; y: number } | null {
  try {
    const visible = scroll.getMetrics().pageVisibilityMetrics;
    if (visible.length === 0) return null;
    const top = visible.reduce((best, item) => (item.viewportY < best.viewportY ? item : best));
    return { pageNumber: top.pageNumber, x: top.original.pageX, y: top.original.pageY };
  } catch {
    return null;
  }
}

function currentPageOf(scroll: ScrollProvides): number {
  try {
    return scroll.getMetrics().currentPage;
  } catch {
    return 1;
  }
}

export function useSyncedScroll(enabled: boolean, primaryId: string, paneId: string) {
  const { provides: viewport } = useViewportCapability();
  const { provides: primaryScroll } = useScroll(primaryId);
  const { provides: paneScroll } = useScroll(paneId);
  const { documents } = useRegistry();
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  useEffect(() => {
    if (!enabled || !viewport || !primaryScroll || !paneScroll) return;
    const offset = pageOffsetBetween(currentPageOf(primaryScroll), currentPageOf(paneScroll));
    const ids: Record<Side, string> = { primary: primaryId, pane: paneId };
    const scrolls: Record<Side, ScrollProvides> = { primary: primaryScroll, pane: paneScroll };
    const quietUntil: Record<Side, number> = { primary: 0, pane: 0 };
    const frames: number[] = [];
    const pdfOf = (side: Side) => documentsRef.current[ids[side]]?.document ?? null;
    const heightOf = (side: Side, pageNumber: number) => pdfOf(side)?.pages[pageNumber - 1]?.size.height ?? 0;

    const follow = (source: Side) => {
      if (performance.now() < quietUntil[source]) return;
      const target: Side = source === "primary" ? "pane" : "primary";
      quietUntil[target] = performance.now() + FOLLOW_QUIET_MS;
      frames.push(
        window.requestAnimationFrame(() => {
          const top = topOfView(scrolls[source]);
          if (!top) return;
          const position = scrollPositionOf(top.pageNumber, top.y, heightOf(source, top.pageNumber));
          const spot = syncTargetOf(position, source === "primary" ? offset : -offset, pdfOf(target)?.pageCount ?? 0);
          if (!spot) return;
          quietUntil[target] = performance.now() + FOLLOW_QUIET_MS;
          scrolls[target].scrollToPage({
            pageNumber: spot.pageNumber,
            pageCoordinates: { x: top.x, y: spot.fraction * heightOf(target, spot.pageNumber) },
            behavior: "instant",
            alignX: 0,
            alignY: 0,
          });
        }),
      );
    };

    const stopPrimary = viewport.forDocument(primaryId).onScrollChange(() => follow("primary"));
    const stopPane = viewport.forDocument(paneId).onScrollChange(() => follow("pane"));
    return () => {
      stopPrimary();
      stopPane();
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
    };
  }, [enabled, viewport, primaryScroll, paneScroll, primaryId, paneId]);
}

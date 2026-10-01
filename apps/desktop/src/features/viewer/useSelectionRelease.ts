import { useEffect, useRef, type RefObject } from "react";
import type { GlyphPointer } from "@embedpdf/plugin-selection";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { useRotate } from "@embedpdf/plugin-rotate/react";
import { frameSizePx, quarterTurns, screenToFrame } from "./overlay/pageFrame";
import { visiblePageSize } from "./overlay/pageSize";
import { DRAG_MIN_PX, nearestGlyph, releasedRange } from "./selectionRelease";

type Release = { page: number; x: number; y: number };

export function useSelectionRelease(hostRef: RefObject<HTMLDivElement | null>, documentId: string) {
  const { provides: selection } = useSelectionCapability();
  const { rotation } = useRotate(documentId);
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;

  useEffect(() => {
    const host = hostRef.current;
    const scope = selection?.forDocument(documentId);
    if (!host || !scope) return;
    let start: GlyphPointer | null = null;
    let origin: { x: number; y: number } | null = null;
    let release: Release | null = null;
    let timer = 0;

    const releaseAt = (event: PointerEvent): Release | null => {
      const pageElement = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-page-index]");
      if (!pageElement || !host.contains(pageElement)) return null;
      const pageIndex = Number(pageElement.dataset.pageIndex);
      const rect = pageElement.getBoundingClientRect();
      const page = visiblePageSize(documentId, pageIndex, rect.width, rect.height);
      const viewTurns = quarterTurns(rotationRef.current, "quarters");
      const scale = frameSizePx(viewTurns, rect.width, rect.height).width / page.width;
      const local = screenToFrame(event.clientX, event.clientY, rect, viewTurns);
      return { page: pageIndex, x: local.x / scale, y: local.y / scale };
    };
    const onPointerDown = (event: PointerEvent) => {
      origin = { x: event.clientX, y: event.clientY };
      release = null;
    };
    const onPointerUp = (event: PointerEvent) => {
      const moved = origin !== null && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > DRAG_MIN_PX;
      origin = null;
      release = moved ? releaseAt(event) : null;
    };
    const offBegin = scope.onBeginSelection(({ page, index }) => {
      start = { page, index };
    });
    const offEnd = scope.onEndSelection(() => {
      const begun = start;
      start = null;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const point = release;
        release = null;
        if (!begun || !point) return;
        const state = scope.getState();
        if (state.selection) return;
        const geometry = state.geometry[point.page];
        const index = geometry ? nearestGlyph(geometry, point.x, point.y) : null;
        if (index === null) return;
        void scope.setSelection(releasedRange(begun, { page: point.page, index }));
      }, 0);
    });

    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("pointerup", onPointerUp, true);
    return () => {
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("pointerup", onPointerUp, true);
      offBegin();
      offEnd();
      window.clearTimeout(timer);
    };
  }, [hostRef, selection, documentId]);
}

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { selectionBounds } from "../model/edit";
import { canvasBridge } from "./canvasBridge";
import { PAD, type Point } from "./canvasGeometry";
import { currentPage, useStudioStore } from "./studioStore";

const ZOOM_STEP = 1.1;
const SELECTION_ZOOM_MARGIN = 0.8;

type CanvasViewport = {
  viewportRef: RefObject<HTMLDivElement | null>;
  pageRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  fit: boolean;
  pageWidth: number;
  pageHeight: number;
};

export function useCanvasViewport({ viewportRef, pageRef, zoom, fit, pageWidth, pageHeight }: CanvasViewport) {
  const zoomAnchor = useRef<{ page: Point; client: Point } | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pageWidth || !pageHeight || !fit) return;
    const measure = () => {
      const width = viewport.clientWidth - PAD * 2;
      const height = viewport.clientHeight - PAD * 2;
      if (width > 0 && height > 0) useStudioStore.getState().applyFitZoom(Math.min(width / pageWidth, height / pageHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef, fit, pageWidth, pageHeight]);

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const viewport = viewportRef.current;
    const host = pageRef.current;
    if (!anchor || !viewport || !host) return;
    zoomAnchor.current = null;
    const rect = host.getBoundingClientRect();
    viewport.scrollLeft += rect.left + anchor.page.x * zoom - anchor.client.x;
    viewport.scrollTop += rect.top + anchor.page.y * zoom - anchor.client.y;
  }, [viewportRef, pageRef, zoom]);

  useEffect(
    () =>
      useStudioStore.subscribe((next, previous) => {
        if (next.zoom === previous.zoom || next.fit || zoomAnchor.current) return;
        const viewport = viewportRef.current;
        const host = pageRef.current;
        if (!viewport || !host) return;
        const view = viewport.getBoundingClientRect();
        const rect = host.getBoundingClientRect();
        const client = { x: view.left + view.width / 2, y: view.top + view.height / 2 };
        zoomAnchor.current = { page: { x: (client.x - rect.left) / previous.zoom, y: (client.y - rect.top) / previous.zoom }, client };
      }),
    [viewportRef, pageRef],
  );

  useEffect(() => {
    canvasBridge.current = {
      zoomToSelection: () => {
        const viewport = viewportRef.current;
        const state = useStudioStore.getState();
        const current = currentPage(state);
        if (!viewport || !current) return;
        const box = (state.selection.length ? selectionBounds(current, state.selection) : null) ?? { x: 0, y: 0, width: current.width, height: current.height };
        const view = viewport.getBoundingClientRect();
        const target = Math.min((view.width * SELECTION_ZOOM_MARGIN) / Math.max(1, box.width), (view.height * SELECTION_ZOOM_MARGIN) / Math.max(1, box.height));
        zoomAnchor.current = { page: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, client: { x: view.left + view.width / 2, y: view.top + view.height / 2 } };
        state.setZoom(target);
        if (useStudioStore.getState().zoom === state.zoom) {
          zoomAnchor.current = null;
          const rect = pageRef.current?.getBoundingClientRect();
          if (!rect) return;
          viewport.scrollLeft += rect.left + (box.x + box.width / 2) * state.zoom - (view.left + view.width / 2);
          viewport.scrollTop += rect.top + (box.y + box.height / 2) * state.zoom - (view.top + view.height / 2);
        }
      },
    };
    return () => {
      canvasBridge.current = null;
    };
  }, [viewportRef, pageRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const host = pageRef.current;
      if (!host) return;
      const state = useStudioStore.getState();
      const rect = host.getBoundingClientRect();
      zoomAnchor.current = { page: { x: (event.clientX - rect.left) / state.zoom, y: (event.clientY - rect.top) / state.zoom }, client: { x: event.clientX, y: event.clientY } };
      state.setZoom(state.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewportRef, pageRef]);
}

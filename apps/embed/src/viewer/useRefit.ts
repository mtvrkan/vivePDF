import { useEffect } from "preact/hooks";
import { ZoomMode, useZoomCapability } from "@embedpdf/plugin-zoom/preact";

export function useRefit(documentId: string, host: HTMLElement | null, viewportGap: number): void {
  const { provides: zoom } = useZoomCapability();

  useEffect(() => {
    const viewport = host?.querySelector(".vp-stage");
    if (!zoom || !viewport) return;
    const scope = zoom.forDocument(documentId);
    const firstPageCorner = { vx: viewportGap, vy: viewportGap };
    let frame = 0;
    let lastWidth = -1;
    let lastHeight = -1;
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth === lastWidth && viewport.clientHeight === lastHeight) return;
      const first = lastWidth < 0;
      lastWidth = viewport.clientWidth;
      lastHeight = viewport.clientHeight;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const level = scope.getState().zoomLevel;
        if (level === ZoomMode.FitWidth || level === ZoomMode.FitPage) scope.requestZoom(level, first ? firstPageCorner : undefined);
      });
    });
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [zoom, host, documentId, viewportGap]);
}

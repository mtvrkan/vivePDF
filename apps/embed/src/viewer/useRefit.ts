import { useEffect } from "preact/hooks";
import { ZoomMode, useZoomCapability } from "@embedpdf/plugin-zoom/preact";

export function useRefit(documentId: string, host: HTMLElement | null): void {
  const { provides: zoom } = useZoomCapability();

  useEffect(() => {
    const viewport = host?.querySelector(".vp-stage");
    if (!zoom || !viewport) return;
    const scope = zoom.forDocument(documentId);
    let frame = 0;
    let lastWidth = viewport.clientWidth;
    let lastHeight = viewport.clientHeight;
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth === lastWidth && viewport.clientHeight === lastHeight) return;
      lastWidth = viewport.clientWidth;
      lastHeight = viewport.clientHeight;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const level = scope.getState().zoomLevel;
        if (level === ZoomMode.FitWidth || level === ZoomMode.FitPage) scope.requestZoom(level);
      });
    });
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [zoom, host, documentId]);
}

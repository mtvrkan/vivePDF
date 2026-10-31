import { useEffect, useRef, useState } from "preact/hooks";
import { useScroll, useScrollCapability } from "@embedpdf/plugin-scroll/preact";
import { ZoomMode, useZoomCapability } from "@embedpdf/plugin-zoom/preact";

const RETURN_WAIT_MS = 300;

export function useRefit(documentId: string, host: HTMLElement | null, viewportGap: number): boolean {
  const { provides: zoom } = useZoomCapability();
  const { provides: scroll } = useScrollCapability();
  const { state: scrollState } = useScroll(documentId);
  const [fitted, setFitted] = useState(false);
  const shownRef = useRef(false);
  const pageRef = useRef(1);
  useEffect(() => {
    const viewport = host?.querySelector(".vp-stage");
    if (shownRef.current && viewport && viewport.clientHeight > 0) pageRef.current = scrollState.currentPage;
  }, [host, scrollState.currentPage]);

  useEffect(() => {
    const viewport = host?.querySelector(".vp-stage");
    if (!zoom || !scroll || !viewport) return;
    const scope = zoom.forDocument(documentId);
    const pages = scroll.forDocument(documentId);
    const firstPageCorner = { vx: viewportGap, vy: viewportGap };
    let frame = 0;
    let lastWidth = -1;
    let lastHeight = -1;
    let stopReturn = () => {};
    const returnTo = (page: number, level: ZoomMode | null) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stopReturn();
        frame = requestAnimationFrame(() => {
          pages.scrollToPage({ pageNumber: page, behavior: "instant" });
          shownRef.current = true;
          setFitted(true);
        });
      };
      if (level === null) return finish();
      const unsubscribe = scope.onZoomChange(finish);
      const timer = window.setTimeout(finish, RETURN_WAIT_MS);
      stopReturn = () => {
        window.clearTimeout(timer);
        unsubscribe();
        stopReturn = () => {};
      };
      scope.requestZoom(level);
    };
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth === 0 || viewport.clientHeight === 0) {
        if (!shownRef.current) return;
        shownRef.current = false;
        lastWidth = 0;
        lastHeight = 0;
        cancelAnimationFrame(frame);
        stopReturn();
        setFitted(false);
        return;
      }
      if (viewport.clientWidth === lastWidth && viewport.clientHeight === lastHeight) return;
      const first = lastWidth < 0;
      const returning = lastWidth === 0;
      lastWidth = viewport.clientWidth;
      lastHeight = viewport.clientHeight;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const level = scope.getState().zoomLevel;
        const fits = level === ZoomMode.FitWidth || level === ZoomMode.FitPage;
        if (returning) {
          returnTo(pageRef.current, fits ? level : null);
          return;
        }
        if (fits) scope.requestZoom(level, first ? firstPageCorner : undefined);
        if (first) {
          shownRef.current = true;
          setFitted(true);
        }
      });
    });
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      stopReturn();
      observer.disconnect();
    };
  }, [zoom, scroll, host, documentId, viewportGap]);
  return fitted;
}

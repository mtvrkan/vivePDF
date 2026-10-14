import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { ZoomMode, useZoom, type ZoomLevel } from "@embedpdf/plugin-zoom/react";
import { useUiStore } from "@/shared/store/uiStore";

const REFIT_DEBOUNCE_MS = 120;
const FIT_CAPTURE_DELAY_MS = 220;
const ENTRY_SETTLE_MS = 80;
const ENTRY_TIMEOUT_MS = 700;

export function usePresentationFit(documentId: string, containerRef: RefObject<HTMLElement | null>, startPage?: number | null) {
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const zoomBeforeEntering = useRef<ZoomLevel>(zoomState.zoomLevel);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomReady = Boolean(zoom);
  const zoomStateRef = useRef(zoomState);
  zoomStateRef.current = zoomState;
  const fitLevelRef = useRef<number | null>(null);
  const manualZoomRef = useRef(false);
  const fitTimer = useRef<number | null>(null);
  const captureTimer = useRef<number | null>(null);
  const pendingPageRestore = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const [settled, setSettled] = useState(false);
  const scrollRef = useRef({ scroll, scrollState });
  scrollRef.current = { scroll, scrollState };
  const startPageRef = useRef(startPage);
  startPageRef.current = startPage;

  useEffect(() => {
    const cap = window.setTimeout(() => setSettled(true), ENTRY_TIMEOUT_MS);
    return () => window.clearTimeout(cap);
  }, []);

  const finishEntry = useCallback(() => {
    const pageNumber = pendingPageRestore.current;
    if (pageNumber === null) return;
    pendingPageRestore.current = null;
    fitLevelRef.current = zoomStateRef.current.currentZoomLevel;
    scrollRef.current.scroll?.scrollToPage({ pageNumber, behavior: "instant" });
    window.requestAnimationFrame(() => setSettled(true));
  }, []);

  const armSettle = useCallback(() => {
    if (pendingPageRestore.current === null) return;
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(finishEntry, ENTRY_SETTLE_MS);
  }, [finishEntry]);

  const scheduleFit = useCallback(() => {
    const entering = pendingPageRestore.current !== null;
    if (fitTimer.current !== null) window.clearTimeout(fitTimer.current);
    fitTimer.current = window.setTimeout(() => {
      if (!entering && manualZoomRef.current) return;
      zoomRef.current?.requestZoom(ZoomMode.FitPage);
      if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
      captureTimer.current = window.setTimeout(() => {
        fitLevelRef.current = zoomStateRef.current.currentZoomLevel;
      }, FIT_CAPTURE_DELAY_MS);
    }, entering ? 0 : REFIT_DEBOUNCE_MS);
    armSettle();
  }, [armSettle]);

  useEffect(() => {
    if (!zoomReady) return;
    const previous = zoomBeforeEntering.current;
    const { scroll: current, scrollState: state } = scrollRef.current;
    const requested = startPageRef.current !== undefined ? startPageRef.current : useUiStore.getState().immersiveStartPage;
    pendingPageRestore.current = requested ?? current?.getCurrentPage() ?? state.currentPage;
    scheduleFit();
    return () => {
      if (fitTimer.current !== null) window.clearTimeout(fitTimer.current);
      if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      pendingPageRestore.current = null;
      setSettled(false);
      zoomRef.current?.requestZoom(previous);
    };
  }, [zoomReady, scheduleFit]);

  useEffect(() => {
    armSettle();
  }, [zoomState.currentZoomLevel, armSettle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !zoomReady) return;
    const observer = new ResizeObserver(() => scheduleFit());
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, zoomReady, scheduleFit]);

  return { settled, fitLevelRef, manualZoomRef, zoomStateRef, scrollRef };
}

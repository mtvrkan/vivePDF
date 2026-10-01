import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { ZoomMode, useZoom, type ZoomLevel } from "@embedpdf/plugin-zoom/react";
import { Button } from "@/components/shared/Button";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useUiStore } from "@/shared/store/uiStore";
import { AnnotateBar } from "./AnnotateBar";
import { PageView } from "./PageView";
import { BlackoutLayer } from "./presentation/BlackoutLayer";
import { CodeBlockMarkers } from "./presentation/CodeBlockMarkers";
import { CodeBlockOverlay } from "./presentation/CodeBlockOverlay";
import { OverviewGrid } from "./presentation/OverviewGrid";
import { PresentationCanvas } from "./presentation/PresentationCanvas";
import { usePageRects } from "./presentation/usePageRects";
import { usePinchSignal } from "./presentation/pinchSignal";
import { PresenterBar } from "./ImmersiveBar";
import { trackSessionAnnotation, type SessionAnnotation } from "./sessionAnnotations";
import { outsideRender } from "@/shared/lib/outsideRender";

const WHEEL_FLIP_THRESHOLD = 40;
const WHEEL_FLIP_COOLDOWN_MS = 320;
const REFIT_DEBOUNCE_MS = 120;
const FIT_CAPTURE_DELAY_MS = 220;
const ENTRY_SETTLE_MS = 80;
const ENTRY_TIMEOUT_MS = 700;
const CURSOR_IDLE_MS = 2000;

function PresentationErrorBoundary({ onExit, children }: { onExit: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
          <div className="glass pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2 text-sm">
            <span>{t("presentation.crashNotice")}</span>
            <Button size="sm" variant="ghost" onClick={reset}>
              {t("common.retry")}
            </Button>
            <Button size="sm" variant="secondary" onClick={onExit}>
              {t("presentation.exitOnCrash")}
            </Button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

export function ImmersiveView({ documentId, onExit }: { documentId: string; onExit: () => void }) {
  const { provides: annotation } = useAnnotation(documentId);
  const annotationRef = useRef(annotation);
  annotationRef.current = annotation;
  const sessionAnnotations = useRef<SessionAnnotation[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const containerRef = useRef<HTMLDivElement>(null);
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
  const wheelAccumulator = useRef(0);
  const lastFlip = useRef(0);
  const scrollRef = useRef({ scroll, scrollState });
  scrollRef.current = { scroll, scrollState };
  const pageRects = usePageRects(containerRef);

  const tool = usePresentationStore((state) => state.tool);
  const drawingsMode = usePresentationStore((state) => state.drawingsMode);
  const overviewOpen = usePresentationStore((state) => state.overviewOpen);
  const setOverviewOpen = usePresentationStore((state) => state.setOverviewOpen);
  const codeBlockOpen = usePresentationStore((state) => state.codeBlockOpen);
  const cursorAutoHide = usePresentationStore((state) => state.cursorAutoHide);
  const [cursorHidden, setCursorHidden] = useState(false);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    useUiStore.getState().setImmersiveMounted(true);
    const cap = window.setTimeout(() => setSettled(true), ENTRY_TIMEOUT_MS);
    return () => {
      window.clearTimeout(cap);
      useUiStore.getState().setImmersiveMounted(false);
    };
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
    pendingPageRestore.current = useUiStore.getState().immersiveStartPage ?? current?.getCurrentPage() ?? state.currentPage;
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
  }, [zoomReady, scheduleFit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        manualZoomRef.current = true;
        return;
      }
      const fitLevel = fitLevelRef.current;
      if (fitLevel !== null && zoomStateRef.current.currentZoomLevel > fitLevel * 1.02) return;
      event.preventDefault();
      wheelAccumulator.current += event.deltaY;
      const now = performance.now();
      if (Math.abs(wheelAccumulator.current) < WHEEL_FLIP_THRESHOLD || now - lastFlip.current < WHEEL_FLIP_COOLDOWN_MS) return;
      const { scroll: current, scrollState: state } = scrollRef.current;
      if (wheelAccumulator.current > 0 && state.currentPage < state.totalPages) current?.scrollToNextPage();
      else if (wheelAccumulator.current < 0 && state.currentPage > 1) current?.scrollToPreviousPage();
      wheelAccumulator.current = 0;
      lastFlip.current = now;
    };
    container.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => container.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  useEffect(() => {
    const scope = annotationRef.current;
    if (!scope || drawingsMode !== "annotations") return;
    const unsubscribe = scope.onAnnotationEvent((event) => {
      if (event.type !== "create" && event.type !== "delete") return;
      const next = trackSessionAnnotation(sessionAnnotations.current, { type: event.type, pageIndex: event.pageIndex, annotation: { id: event.annotation.id } });
      if (next === sessionAnnotations.current) return;
      sessionAnnotations.current = next;
      outsideRender(() => setSessionCount(next.length));
    });
    return () => unsubscribe();
  }, [annotation, drawingsMode]);

  useEffect(() => {
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const scheduleCursorIdle = () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setCursorHidden(true), CURSOR_IDLE_MS);
  };

  const onMouseMove = () => {
    if (cursorHidden) setCursorHidden(false);
    if (tool === "pointer" && cursorAutoHide) scheduleCursorIdle();
  };

  const onManualZoom = () => {
    manualZoomRef.current = true;
  };

  usePinchSignal(containerRef, onManualZoom);

  const clearSessionAnnotations = () => {
    const scope = annotationRef.current;
    if (!scope || sessionAnnotations.current.length === 0) return;
    scope.deleteAnnotations(sessionAnnotations.current);
    sessionAnnotations.current = [];
    setSessionCount(0);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={onMouseMove}
      className={cn("immersive-view relative min-h-0 flex-1 bg-black", cursorHidden && tool === "pointer" && cursorAutoHide && "cursor-none")}
    >
      <div className="absolute inset-0 bg-muted" aria-hidden />
      <div className={cn("h-full transition-opacity duration-150", settled ? "opacity-100" : "opacity-0")}>
        <PageView documentId={documentId} />
      </div>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pageRects.map((rect) => (
          <CodeBlockMarkers key={rect.pageIndex} documentId={documentId} rect={rect} />
        ))}
      </div>
      <BlackoutLayer />
      {drawingsMode === "annotations" ? (
        <div className="fixed left-3 top-1/2 z-30 -translate-y-1/2">
          <AnnotateBar documentId={documentId} layout="dock" />
        </div>
      ) : null}
      <PresentationErrorBoundary onExit={onExit}>
        <PresentationCanvas containerRef={containerRef} />
        <PresenterBar
          documentId={documentId}
          onExit={onExit}
          onManualZoom={onManualZoom}
          sessionAnnotationCount={sessionCount}
          onClearSessionAnnotations={clearSessionAnnotations}
        />
        {overviewOpen ? <OverviewGrid documentId={documentId} onClose={() => setOverviewOpen(false)} /> : null}
        {codeBlockOpen ? <CodeBlockOverlay pageIndex={codeBlockOpen.pageIndex} blockId={codeBlockOpen.blockId} /> : null}
      </PresentationErrorBoundary>
    </div>
  );
}

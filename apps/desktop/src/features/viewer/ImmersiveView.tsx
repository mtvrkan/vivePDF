import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { cn } from "@/shared/lib/cn";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { LiveSignal } from "./presentation/liveSignal";
import { AnnotateBar } from "./AnnotateBar";
import { PageView } from "./PageView";
import { BlackoutLayer } from "./presentation/BlackoutLayer";
import { CodeBlockMarkers } from "./presentation/CodeBlockMarkers";
import { CodeBlockOverlay } from "./presentation/CodeBlockOverlay";
import { CurrentPageMask } from "./presentation/CurrentPageMask";
import { OverviewGrid } from "./presentation/OverviewGrid";
import { SavedDrawingCanvas } from "./presentation/SavedDrawingCanvas";
import { usePageRects } from "./presentation/usePageRects";
import { usePinchSignal } from "./presentation/pinchSignal";
import { usePresentationFit } from "./presentation/usePresentationFit";
import { PresenterBar } from "./ImmersiveBar";
import { trackSessionAnnotation, type SessionAnnotation } from "./sessionAnnotations";
import { outsideRender } from "@/shared/lib/outsideRender";

const WHEEL_FLIP_THRESHOLD = 40;
const WHEEL_FLIP_COOLDOWN_MS = 320;
const CURSOR_IDLE_MS = 2000;

function PresentationErrorBoundary({ onExit, children }: { onExit: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      keepImmersive
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

type ImmersiveViewProps = { documentId: string; onExit: () => void; variant?: "solo" | "console"; onSignal?: (signal: LiveSignal) => void };

export function ImmersiveView({ documentId, onExit, variant = "solo", onSignal }: ImmersiveViewProps) {
  const { provides: annotation } = useAnnotation(documentId);
  const annotationRef = useRef(annotation);
  annotationRef.current = annotation;
  const sessionAnnotations = useRef<SessionAnnotation[]>([]);
  const [sessionItems, setSessionItems] = useState<SessionAnnotation[]>([]);
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const containerRef = useRef<HTMLDivElement>(null);
  const { settled, fitLevelRef, manualZoomRef, zoomStateRef } = usePresentationFit(documentId, containerRef);
  const wheelAccumulator = useRef(0);
  const lastFlip = useRef(0);
  const scrollRef = useRef({ scroll, scrollState });
  scrollRef.current = { scroll, scrollState };
  const asConsole = variant === "console";
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
    return () => useUiStore.getState().setImmersiveMounted(false);
  }, []);

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
  }, [fitLevelRef, manualZoomRef, zoomStateRef]);

  useEffect(() => {
    const scope = annotationRef.current;
    if (!scope || drawingsMode !== "annotations") return;
    const unsubscribe = scope.onAnnotationEvent((event) => {
      if (event.type !== "create" && event.type !== "delete") return;
      const next = trackSessionAnnotation(sessionAnnotations.current, { type: event.type, pageIndex: event.pageIndex, annotation: { id: event.annotation.id } });
      if (next === sessionAnnotations.current) return;
      sessionAnnotations.current = next;
      outsideRender(() => setSessionItems(next));
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

  const clearSessionAnnotations = (pageIndex?: number) => {
    const scope = annotationRef.current;
    const doomed = sessionAnnotations.current.filter((item) => pageIndex === undefined || item.pageIndex === pageIndex);
    if (!scope || doomed.length === 0) return;
    scope.deleteAnnotations(doomed);
    const kept = sessionAnnotations.current.filter((item) => !doomed.includes(item));
    sessionAnnotations.current = kept;
    setSessionItems(kept);
  };
  const clearSessionRef = useRef(clearSessionAnnotations);
  clearSessionRef.current = clearSessionAnnotations;

  useEffect(() => {
    if (drawingsMode !== "annotations") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== "e" || isTypingTarget(event.target)) return;
      event.preventDefault();
      clearSessionRef.current(scrollRef.current.scrollState.currentPage - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawingsMode]);

  return (
    <div
      ref={containerRef}
      onMouseMove={onMouseMove}
      className={cn("immersive-view relative min-h-0 flex-1 bg-black", asConsole && "overflow-hidden", cursorHidden && tool === "pointer" && cursorAutoHide && "cursor-none")}
    >
      <div className={cn("h-full transition-opacity duration-150", settled ? "opacity-100" : "opacity-0")}>
        <PageView documentId={documentId} backdrop="black" />
      </div>
      {settled ? <CurrentPageMask rects={pageRects} pageIndex={scrollState.currentPage - 1} /> : null}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pageRects.map((rect) => (
          <CodeBlockMarkers key={rect.pageIndex} documentId={documentId} rect={rect} />
        ))}
      </div>
      <BlackoutLayer contained={asConsole} />
      {drawingsMode === "annotations" && !asConsole ? (
        <div className="fixed left-3 top-1/2 z-30 -translate-y-1/2">
          <AnnotateBar documentId={documentId} layout="dock" />
        </div>
      ) : null}
      <PresentationErrorBoundary onExit={onExit}>
        <SavedDrawingCanvas documentId={documentId} containerRef={containerRef} contained={asConsole} onSignal={onSignal} />
        {asConsole ? null : (
          <PresenterBar
            documentId={documentId}
            onExit={onExit}
            onManualZoom={onManualZoom}
            sessionAnnotations={sessionItems}
            onClearSessionAnnotations={clearSessionAnnotations}
          />
        )}
        {overviewOpen ? <OverviewGrid documentId={documentId} onClose={() => setOverviewOpen(false)} /> : null}
        {codeBlockOpen ? <CodeBlockOverlay pageIndex={codeBlockOpen.pageIndex} blockId={codeBlockOpen.blockId} /> : null}
      </PresentationErrorBoundary>
    </div>
  );
}

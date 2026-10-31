import { useEffect, useRef } from "preact/hooks";
import { useScroll, useScrollCapability } from "@embedpdf/plugin-scroll/preact";
import { ZoomMode, useZoom, useZoomCapability } from "@embedpdf/plugin-zoom/preact";
import { answerAnnotate } from "./annotateCommands";
import type { AnnotateApi, ViewerCommand, ViewerEvent } from "./bridge";
import type { CommandQueue } from "./commandQueue";
import { zoomPercent } from "./pageInput";

export type ApiHandlers = { search: ((query: string) => void) | null; print: (() => void) | null; download: (() => void) | null; annotate: AnnotateApi | null; start: StartPage };
export type StartPage = { settle: () => void; pending: () => number | null };

const PERCENT = 100;
const ZOOM_WATCH_MS = 1000;

export function useViewerApi(documentId: string, fitted: boolean, commands: CommandQueue<ViewerCommand>, emit: (event: ViewerEvent) => void, handlers: ApiHandlers): void {
  const { state: scrollState } = useScroll(documentId);
  const { state: zoomState } = useZoom(documentId);
  const { provides: scrollCapability } = useScrollCapability();
  const { provides: zoomCapability } = useZoomCapability();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const anchorRef = useRef(scrollState.currentPage);
  const reportedRef = useRef({ page: "", zoom: -1 });

  useEffect(() => {
    if (!fitted || !scrollCapability || !zoomCapability) return;
    const scroll = scrollCapability.forDocument(documentId);
    const zoom = zoomCapability.forDocument(documentId);
    const frames = new Set<number>();
    const nextFrame = (run: () => void) => {
      const frame = requestAnimationFrame(() => {
        frames.delete(frame);
        run();
      });
      frames.add(frame);
    };
    let keptPage: number | null = null;
    let stopWatching = () => {};
    const keepPage = (page: number, once: boolean) => {
      stopWatching();
      keptPage = page;
      const unsubscribe = zoom.onZoomChange(() => {
        if (once) {
          unsubscribe();
          window.clearTimeout(timer);
        }
        nextFrame(() => {
          if (keptPage !== null) scroll.scrollToPage({ pageNumber: keptPage, behavior: "instant" });
          if (once) keptPage = null;
        });
      });
      const timer = window.setTimeout(stopWatching, ZOOM_WATCH_MS);
      stopWatching = () => {
        window.clearTimeout(timer);
        unsubscribe();
        keptPage = null;
        stopWatching = () => {};
      };
    };
    const stop = commands.listen((command) => {
      const current = handlersRef.current;
      if (command.kind === "goTo") {
        current.start.settle();
        const page = Math.min(command.page, scroll.getTotalPages());
        anchorRef.current = page;
        keepPage(page, false);
        scroll.scrollToPage({ pageNumber: page, behavior: "instant" });
      } else if (command.kind === "zoom") {
        const pending = current.start.pending();
        if (pending === null) current.start.settle();
        const level = command.zoom === "fit-width" ? ZoomMode.FitWidth : command.zoom === "fit-page" ? ZoomMode.FitPage : command.zoom / PERCENT;
        nextFrame(() => {
          keepPage(pending ?? anchorRef.current, true);
          zoom.requestZoom(level);
        });
      } else if (command.kind === "search") current.search?.(command.query);
      else if (command.kind === "print") current.print?.();
      else if (command.kind === "download") current.download?.();
      else answerAnnotate(current.annotate, command);
    });
    return () => {
      stop();
      stopWatching();
      for (const frame of frames) cancelAnimationFrame(frame);
    };
  }, [fitted, scrollCapability, zoomCapability, documentId, commands]);

  useEffect(() => {
    anchorRef.current = scrollState.currentPage;
    const page = `${scrollState.currentPage}/${scrollState.totalPages}`;
    if (!fitted || reportedRef.current.page === page) return;
    reportedRef.current.page = page;
    emit({ type: "pagechange", detail: { page: scrollState.currentPage, pageCount: scrollState.totalPages } });
  }, [fitted, emit, scrollState.currentPage, scrollState.totalPages]);

  useEffect(() => {
    const zoom = zoomPercent(zoomState.currentZoomLevel);
    if (!fitted || reportedRef.current.zoom === zoom) return;
    reportedRef.current.zoom = zoom;
    emit({ type: "zoomchange", detail: { zoom } });
  }, [fitted, emit, zoomState.currentZoomLevel]);
}

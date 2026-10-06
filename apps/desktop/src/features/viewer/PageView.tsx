import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Viewport } from "@embedpdf/plugin-viewport/react";
import { Scroller } from "@embedpdf/plugin-scroll/react";
import { RenderLayer } from "@embedpdf/plugin-render/react";
import { TilingLayer } from "@embedpdf/plugin-tiling/react";
import { SearchLayer } from "@embedpdf/plugin-search/react";
import { SelectionLayer } from "@embedpdf/plugin-selection/react";
import { AnnotationLayer, useAnnotation } from "@embedpdf/plugin-annotation/react";
import { RedactionLayer } from "@embedpdf/plugin-redaction/react";
import { Rotate } from "@embedpdf/plugin-rotate/react";
import { GlobalPointerProvider, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react";
import { PanMode } from "@embedpdf/plugin-pan/react";
import { MarqueeZoom, ZoomGestureWrapper } from "@embedpdf/plugin-zoom/react";
import type { PageColorScheme } from "@/shared/lib/pageColors";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { AnnotationSelectionMenu } from "./AnnotationSelectionMenu";
import { AreaSelectLayer } from "./AreaSelectLayer";
import { LinkPreview } from "./LinkPreview";
import { PageBitmap } from "./PageBitmap";
import { PageSkeleton } from "./PageSkeleton";
import { PageTextLayer } from "./PageTextLayer";
import { FieldHighlights } from "./FieldHighlights";
import { PageOverlayLayer } from "./overlay/PageOverlayLayer";
import { highlighterCursor, penCursor } from "./presentation/toolCursor";
import { useViewportPan } from "./useViewportPan";
import { useSelectionRelease } from "./useSelectionRelease";
import { useWheelZoom } from "./useWheelZoom";
import { ViewerContextMenu, type ReadOnlySource } from "./ViewerContextMenu";
import { ZoomBadge } from "./ZoomBadge";

const CLICK_MOVE_LIMIT_PX = 4;
const INK_CURSOR_COLOR = "#1f2937";
const EDITABLE_LAYER = { display: "contents" } as const;
const READ_ONLY_LAYER = { display: "contents", pointerEvents: "none" } as const;

export type PageDecoration = (pageIndex: number, width: number, height: number) => ReactNode;

type PageViewProps = { documentId: string; decoratePage?: PageDecoration; pageColors?: PageColorScheme; readOnly?: boolean; readOnlySource?: ReadOnlySource };

export function PageView({ documentId, decoratePage, pageColors = "normal", readOnly = false, readOnlySource }: PageViewProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const selectionColor = usePreferencesStore((state) => state.selectionColor);
  const { provides: annotation, state: annotationState } = useAnnotation(documentId);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !annotation) return;
    let origin: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      origin = { x: event.clientX, y: event.clientY };
    };
    const onClick = (event: MouseEvent) => {
      const start = origin;
      origin = null;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MOVE_LIMIT_PX) return;
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("[data-annotation-menu]")) return;
      const layer = target.closest("[data-annotation-layer]");
      if (layer && layer !== target) return;
      annotation.deselectAnnotation();
    };
    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("click", onClick, true);
    return () => {
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("click", onClick, true);
    };
  }, [annotation]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const markDecorative = (node: Node) => {
      if (node instanceof HTMLImageElement) {
        if (!node.hasAttribute("alt")) node.alt = "";
      } else if (node instanceof Element) {
        node.querySelectorAll("img:not([alt])").forEach((image) => image.setAttribute("alt", ""));
      }
    };
    markDecorative(host);
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(markDecorative);
    });
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  useViewportPan(hostRef);
  useWheelZoom(hostRef, documentId);
  useSelectionRelease(hostRef, documentId);

  const activeAnnotationTool = annotationState.activeToolId ?? null;
  const drawCursor = activeAnnotationTool === "ink" ? penCursor(INK_CURSOR_COLOR) : activeAnnotationTool === "highlight" ? highlighterCursor(INK_CURSOR_COLOR) : null;

  return (
    <div ref={hostRef} className="relative h-full" data-read-only={readOnly ? "" : undefined} data-draw-cursor={drawCursor ? "" : undefined} style={drawCursor ? { cursor: drawCursor } : undefined}>
      <GlobalPointerProvider documentId={documentId}>
        <Viewport documentId={documentId} data-pan-scroller="" tabIndex={0} role="region" aria-label={t("viewer.documentPages")} className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" style={{ height: "100%", backgroundColor: "var(--muted)" }}>
          <PanMode />
          <ZoomGestureWrapper documentId={documentId} enableWheel={false} style={{ display: "block", width: "100%", minWidth: "fit-content" }}>
            <Scroller
              documentId={documentId}
              renderPage={({ width, height, pageIndex }) => (
                <Rotate documentId={documentId} pageIndex={pageIndex} style={{ width, height }}>
                  <PagePointerProvider documentId={documentId} pageIndex={pageIndex} data-page-index={pageIndex} style={{ width, height, position: "relative" }}>
                    <PageSkeleton />
                    <PageBitmap documentId={documentId} pageIndex={pageIndex} scheme={pageColors}>
                      <RenderLayer documentId={documentId} pageIndex={pageIndex} scale={1} role="presentation" />
                      <TilingLayer documentId={documentId} pageIndex={pageIndex} role="presentation" />
                    </PageBitmap>
                    {decoratePage ? decoratePage(pageIndex, width, height) : null}
                    <PageTextLayer documentId={documentId} pageIndex={pageIndex} />
                    <SearchLayer
                      documentId={documentId}
                      pageIndex={pageIndex}
                      highlightColor="color-mix(in oklab, var(--warning) 45%, transparent)"
                      activeHighlightColor="color-mix(in oklab, var(--primary) 55%, transparent)"
                    />
                    <SelectionLayer documentId={documentId} pageIndex={pageIndex} background={selectionColor} />
                    <div data-annotation-layer style={readOnly ? READ_ONLY_LAYER : EDITABLE_LAYER}>
                    <AnnotationLayer
                      documentId={documentId}
                      pageIndex={pageIndex}
                      selectionOutline={{ color: "var(--primary)", style: "dashed", width: 1, offset: 2 }}
                      resizeUI={{ size: 8, color: "var(--primary)" }}
                      selectionMenu={readOnly ? undefined : (menuProps) => <AnnotationSelectionMenu {...menuProps} documentId={documentId} />}
                    />
                    </div>
                    {readOnly ? null : (
                      <>
                        <RedactionLayer documentId={documentId} pageIndex={pageIndex} />
                        <FieldHighlights documentId={documentId} pageIndex={pageIndex} />
                        <MarqueeZoom documentId={documentId} pageIndex={pageIndex} stroke="var(--primary)" fill="color-mix(in oklab, var(--primary) 18%, transparent)" />
                        <PageOverlayLayer documentId={documentId} pageIndex={pageIndex} width={width} height={height} />
                        <AreaSelectLayer documentId={documentId} pageIndex={pageIndex} />
                      </>
                    )}
                  </PagePointerProvider>
                </Rotate>
              )}
            />
          </ZoomGestureWrapper>
        </Viewport>
      </GlobalPointerProvider>
      <ZoomBadge documentId={documentId} />
      {readOnly && !readOnlySource ? null : <ViewerContextMenu documentId={documentId} hostRef={hostRef} readOnlySource={readOnlySource} />}
      <LinkPreview documentId={documentId} hostRef={hostRef} />
    </div>
  );
}

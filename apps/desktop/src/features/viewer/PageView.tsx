import { useCallback, useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
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
import { MarkToolLayer } from "./MarkToolLayer";
import { LinkPreview } from "./LinkPreview";
import { PageBitmap } from "./PageBitmap";
import { PageSkeleton } from "./PageSkeleton";
import { PageTextLayer } from "./PageTextLayer";
import { FieldHighlights } from "./FieldHighlights";
import { PageOverlayLayer } from "./overlay/PageOverlayLayer";
import { FormFieldLayer } from "./forms/FormFieldLayer";
import { FormXfaNotice } from "./forms/FormXfaNotice";
import { PageEditLayer } from "./PageEditLayer";
import { highlighterCursor, penCursor } from "./presentation/toolCursor";
import { useViewportPan } from "./useViewportPan";
import { useSelectionRelease } from "./useSelectionRelease";
import { useWheelZoom } from "./useWheelZoom";
import { ViewerContextMenu, type ReadOnlySource } from "./ViewerContextMenu";
import { ZoomBadge } from "./ZoomBadge";
import { shouldDeselectAfterClick } from "./clickDeselect";
import { annotationStateOf } from "./annotationState";

const CLICK_MOVE_LIMIT_PX = 4;
const INK_CURSOR_COLOR = "#1f2937";
const EDITABLE_LAYER = { display: "contents" } as const;
const READ_ONLY_LAYER = { display: "contents", pointerEvents: "none" } as const;
type AnnotationMenuProps = Parameters<NonNullable<ComponentProps<typeof AnnotationLayer>["selectionMenu"]>>[0];

const SELECTION_OUTLINE = { color: "var(--primary)", style: "dashed", width: 1, offset: 2 } as const;
const RESIZE_UI = { size: 8, color: "var(--primary)" } as const;

export type PageDecoration = (pageIndex: number, width: number, height: number) => ReactNode;

export type PageBackdrop = "muted" | "black";

const BACKDROP_COLORS: Record<PageBackdrop, string> = { muted: "var(--muted)", black: "var(--color-black)" };

type PageViewProps = { documentId: string; decoratePage?: PageDecoration; pageColors?: PageColorScheme; readOnly?: boolean; readOnlySource?: ReadOnlySource; backdrop?: PageBackdrop };

function AnnotationHostBehaviour({ documentId, hostRef }: { documentId: string; hostRef: RefObject<HTMLDivElement | null> }) {
  const clickOrigin = useRef<{ x: number; y: number; selected: string[] } | null>(null);
  const { provides: annotation, state: annotationState } = useAnnotation(documentId);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !annotation) return;
    const onPointerDown = (event: PointerEvent) => {
      clickOrigin.current = { x: event.clientX, y: event.clientY, selected: [...(annotationStateOf(annotation)?.selectedUids ?? [])] };
    };
    const onClick = (event: MouseEvent) => {
      const start = clickOrigin.current;
      clickOrigin.current = null;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MOVE_LIMIT_PX) return;
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("[data-annotation-menu]")) return;
      const layer = target.closest("[data-annotation-layer]");
      if (layer && layer !== target) return;
      const state = annotationStateOf(annotation);
      if (!state || !shouldDeselectAfterClick(start.selected, state.selectedUids ?? [])) return;
      annotation.deselectAnnotation();
    };
    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("click", onClick, true);
    return () => {
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("click", onClick, true);
    };
  }, [annotation, hostRef]);

  const activeAnnotationTool = annotationState.activeToolId ?? null;
  const drawCursor = activeAnnotationTool === "ink" ? penCursor(INK_CURSOR_COLOR) : activeAnnotationTool === "highlight" ? highlighterCursor(INK_CURSOR_COLOR) : null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (drawCursor) {
      host.setAttribute("data-draw-cursor", "");
      host.style.cursor = drawCursor;
    } else {
      host.removeAttribute("data-draw-cursor");
      host.style.cursor = "";
    }
  }, [hostRef, drawCursor]);

  return null;
}

export function PageView({ documentId, decoratePage, pageColors = "normal", readOnly = false, readOnlySource, backdrop = "muted" }: PageViewProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const selectionColor = usePreferencesStore((state) => state.selectionColor);
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

  const selectionMenu = useCallback((menuProps: AnnotationMenuProps) => <AnnotationSelectionMenu {...menuProps} documentId={documentId} />, [documentId]);
  const renderPage = useCallback(
    ({ width, height, pageIndex }: { width: number; height: number; pageIndex: number }) => (
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
            selectionOutline={SELECTION_OUTLINE}
            resizeUI={RESIZE_UI}
            selectionMenu={readOnly ? undefined : selectionMenu}
          />
          </div>
          {readOnly ? null : (
            <>
              <RedactionLayer documentId={documentId} pageIndex={pageIndex} />
              <FieldHighlights documentId={documentId} pageIndex={pageIndex} />
              {decoratePage ? null : <FormFieldLayer documentId={documentId} pageIndex={pageIndex} width={width} height={height} />}
              <MarqueeZoom documentId={documentId} pageIndex={pageIndex} stroke="var(--primary)" fill="color-mix(in oklab, var(--primary) 18%, transparent)" />
              <PageOverlayLayer documentId={documentId} pageIndex={pageIndex} width={width} height={height} />
              <MarkToolLayer documentId={documentId} pageIndex={pageIndex} />
              {decoratePage ? null : <PageEditLayer documentId={documentId} pageIndex={pageIndex} />}
            </>
          )}
        </PagePointerProvider>
      </Rotate>
    ),
    [documentId, pageColors, decoratePage, selectionColor, readOnly, selectionMenu],
  );

  return (
    <div ref={hostRef} className="relative h-full" data-read-only={readOnly ? "" : undefined}>
      <AnnotationHostBehaviour documentId={documentId} hostRef={hostRef} />
      <GlobalPointerProvider documentId={documentId}>
        <Viewport documentId={documentId} data-pan-scroller="" tabIndex={0} role="region" aria-label={t("viewer.documentPages")} className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" style={{ height: "100%", backgroundColor: BACKDROP_COLORS[backdrop] }}>
          <PanMode />
          <ZoomGestureWrapper documentId={documentId} enableWheel={false} style={{ display: "block", width: "100%", minWidth: "fit-content" }}>
            <Scroller
              documentId={documentId}
              renderPage={renderPage}
            />
          </ZoomGestureWrapper>
        </Viewport>
      </GlobalPointerProvider>
      <ZoomBadge documentId={documentId} />
      {readOnly || decoratePage ? null : <FormXfaNotice documentId={documentId} />}
      {readOnly && !readOnlySource ? null : <ViewerContextMenu documentId={documentId} hostRef={hostRef} readOnlySource={readOnlySource} />}
      <LinkPreview documentId={documentId} hostRef={hostRef} />
    </div>
  );
}

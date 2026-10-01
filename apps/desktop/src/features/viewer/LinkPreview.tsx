import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useRegistry } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { tooltipPosition } from "@/components/shared/tooltipPosition";
import { pageLabelOf } from "@/shared/lib/pageLabels";
import { usePageLabels } from "@/shared/store/pageLabelsStore";
import { PREVIEW_WIDTH_PX, destinationOf, linkAtOrigin, previewRect, type HoveredLink } from "./linkTarget";

const SHOW_DELAY_MS = 300;

type Preview = { link: HoveredLink; anchor: DOMRect; image: string | null };

function hoveredLinkElement(node: EventTarget | null): SVGRectElement | null {
  if (!(node instanceof SVGRectElement) || node.style.cursor !== "pointer") return null;
  return node.closest("[data-annotation-layer]") ? node : null;
}

export function LinkPreview({ documentId, hostRef }: { documentId: string; hostRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const { registry, documents } = useRegistry();
  const { state: annotationState } = useAnnotation(documentId);
  const { state: zoomState } = useZoom(documentId);
  const labels = usePageLabels(documentId);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef({ registry, documents, annotationState, scale: zoomState.currentZoomLevel });
  contextRef.current = { registry, documents, annotationState, scale: zoomState.currentZoomLevel };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let timer: number | null = null;
    let current: SVGRectElement | null = null;
    let generation = 0;
    let objectUrl: string | null = null;

    const release = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };

    const hide = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      current = null;
      generation += 1;
      release();
      setPreview(null);
    };

    const resolve = (element: SVGRectElement): HoveredLink | null => {
      const { annotationState: annotations, scale } = contextRef.current;
      const pageElement = element.closest<HTMLElement>("[data-page-index]");
      const wrapper = element.closest("svg")?.parentElement?.parentElement;
      if (!pageElement || !wrapper || scale <= 0) return null;
      const pageIndex = Number(pageElement.dataset.pageIndex);
      const x = parseFloat(wrapper.style.left) / scale;
      const y = parseFloat(wrapper.style.top) / scale;
      if (!Number.isFinite(pageIndex) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const objects = (annotations.pages[pageIndex] ?? []).flatMap((uid) => {
        const tracked = annotations.byUid[uid];
        return tracked ? [tracked.object] : [];
      });
      return linkAtOrigin(objects, x, y);
    };

    const show = (element: SVGRectElement) => {
      const link = resolve(element);
      if (!link) return;
      const anchor = element.getBoundingClientRect();
      const token = ++generation;
      release();
      setPreview({ link, anchor, image: null });
      if (link.kind !== "page") return;
      const { registry: plugins, documents: opened } = contextRef.current;
      const pdfDocument = opened[documentId]?.document;
      const page = pdfDocument?.pages[link.pageIndex];
      if (!plugins || !pdfDocument || !page) return;
      plugins
        .getEngine()
        .renderPageRect(pdfDocument, page, previewRect(destinationOf(link.target), page.size), {
          scaleFactor: PREVIEW_WIDTH_PX / page.size.width,
          dpr: window.devicePixelRatio || 1,
          withAnnotations: true,
        })
        .wait(
          (blob) => {
            if (token !== generation) return;
            objectUrl = URL.createObjectURL(blob);
            const image = objectUrl;
            setPreview((shown) => (shown && shown.link === link ? { ...shown, image } : shown));
          },
          () => undefined,
        );
    };

    const onOver = (event: PointerEvent) => {
      const element = hoveredLinkElement(event.target);
      if (!element) {
        if (current) hide();
        return;
      }
      if (element === current) return;
      hide();
      current = element;
      timer = window.setTimeout(() => {
        timer = null;
        if (current === element && element.isConnected) show(element);
      }, SHOW_DELAY_MS);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && current) hide();
    };

    host.addEventListener("pointerover", onOver);
    host.addEventListener("pointerleave", hide);
    host.addEventListener("pointerdown", hide, true);
    host.addEventListener("wheel", hide, { capture: true, passive: true });
    host.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      host.removeEventListener("pointerover", onOver);
      host.removeEventListener("pointerleave", hide);
      host.removeEventListener("pointerdown", hide, true);
      host.removeEventListener("wheel", hide, { capture: true });
      host.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", hide);
    };
  }, [documentId, hostRef]);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!preview || !bubble) {
      setPosition(null);
      return;
    }
    setPosition(tooltipPosition(preview.anchor, bubble.offsetWidth, bubble.offsetHeight));
  }, [preview]);

  if (!preview) return null;
  const pageLabel = preview.link.kind === "page" ? pageLabelOf(labels, preview.link.pageIndex + 1) : "";

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      data-link-preview
      className="tooltip-pop pointer-events-none fixed z-50 overflow-hidden rounded-xl border border-(--glass-border) bg-card/95 text-xs text-foreground shadow-(--shadow-float) backdrop-blur-md"
      style={{ top: position?.top ?? preview.anchor.bottom, left: position?.left ?? preview.anchor.left, visibility: position ? "visible" : "hidden", width: preview.link.kind === "page" ? PREVIEW_WIDTH_PX : undefined, maxWidth: "calc(100vw - 12px)" }}
    >
      {preview.link.kind === "page" ? (
        <>
          <div className="border-b px-3 py-1.5 font-medium">{t("viewer.link.goToPage", { page: pageLabel })}</div>
          {preview.image ? <img src={preview.image} alt={t("viewer.linkPreview.alt", { page: pageLabel })} className="block w-full" /> : <div className="page-skeleton h-50 w-full" aria-hidden />}
        </>
      ) : (
        <div className="max-w-80 break-all px-3 py-2 font-mono">{preview.link.uri}</div>
      )}
    </div>,
    document.body,
  );
}

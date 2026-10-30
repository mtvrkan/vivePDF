import { useEffect } from "preact/hooks";
import { useScrollCapability } from "@embedpdf/plugin-scroll/preact";
import { useSelectionCapability } from "@embedpdf/plugin-selection/preact";
import { ZoomMode, useZoomCapability } from "@embedpdf/plugin-zoom/preact";
import { viewerKeyAction } from "./viewerKeys";

export function useViewerKeys(documentId: string, host: HTMLElement | null, openSearch: () => void): void {
  const { provides: zoom } = useZoomCapability();
  const { provides: scroll } = useScrollCapability();
  const { provides: selection } = useSelectionCapability();

  useEffect(() => {
    if (!host || !zoom || !scroll || !selection) return;
    const zoomScope = zoom.forDocument(documentId);
    const scrollScope = scroll.forDocument(documentId);
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.composedPath()[0];
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      const action = viewerKeyAction(event, typing);
      if (!action) return;
      event.preventDefault();
      if (action === "search") openSearch();
      else if (action === "zoomIn") zoomScope.zoomIn();
      else if (action === "zoomOut") zoomScope.zoomOut();
      else if (action === "fitWidth") zoomScope.requestZoom(ZoomMode.FitWidth);
      else if (action === "firstPage") scrollScope.scrollToPage({ pageNumber: 1, behavior: "instant" });
      else if (action === "lastPage") scrollScope.scrollToPage({ pageNumber: scrollScope.getTotalPages(), behavior: "instant" });
      else if (action === "copy") selection.forDocument(documentId).copyToClipboard();
    };
    host.addEventListener("keydown", onKeyDown);
    return () => host.removeEventListener("keydown", onKeyDown);
  }, [host, zoom, scroll, selection, documentId, openSearch]);
}

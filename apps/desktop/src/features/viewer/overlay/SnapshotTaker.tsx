import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRegistry } from "@embedpdf/core/react";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { pageTurns, unrotatedRect, visiblePageSize } from "./pageSize";
import { snapshotRect, snapshotScale } from "./snapshot";

export function SnapshotTaker({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const request = useViewerOverlayStore((state) => state.snapshotRequest);
  const { registry, documents } = useRegistry();
  const { state: zoomState } = useZoom(documentId);
  const toast = useToastStore((state) => state.push);
  const contextRef = useRef({ registry, documents, zoom: zoomState.currentZoomLevel });
  contextRef.current = { registry, documents, zoom: zoomState.currentZoomLevel };

  useEffect(() => {
    if (!request) return;
    useViewerOverlayStore.getState().clearSnapshot();
    const { registry: plugins, documents: opened, zoom } = contextRef.current;
    const pdfDocument = opened[documentId]?.document;
    const page = pdfDocument?.pages[request.pageIndex];
    if (!plugins || !pdfDocument || !page) {
      toast("error", t("viewer.snapshot.failed"));
      return;
    }
    const turns = pageTurns(documentId, request.pageIndex);
    const rect = snapshotRect(unrotatedRect(request, turns * 90, visiblePageSize(documentId, request.pageIndex, 0, 0)));
    plugins
      .getEngine()
      .renderPageRect(pdfDocument, page, rect, { scaleFactor: snapshotScale(zoom, rect), rotation: turns, dpr: 1, withAnnotations: true, imageType: "image/png" })
      .wait(
        (blob) => {
          navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
            () => toast("success", t("viewer.snapshot.copied")),
            () => toast("error", t("viewer.snapshot.failed")),
          );
        },
        () => toast("error", t("viewer.snapshot.failed")),
      );
  }, [request, documentId, t, toast]);

  return null;
}

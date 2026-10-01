import { useEffect } from "react";
import { ScrollStrategy } from "@embedpdf/plugin-scroll";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { SpreadMode, useSpread } from "@embedpdf/plugin-spread/react";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { usePageDisplayStore } from "@/shared/store/pageDisplayStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { markDefaultsApplied, zoomLevelFor } from "./openDefaults";

const LAYOUT_SETTLE_MS = [200, 900];

export function ViewerDefaults({ documentId }: { documentId: string }) {
  const { provides: zoom } = useZoom(documentId);
  const { provides: spread } = useSpread(documentId);
  const { provides: scroll } = useScroll(documentId);

  useEffect(() => {
    if (!zoom || !spread || !scroll || !markDefaultsApplied(documentId)) return;
    const { viewerZoom, viewerSpread, viewerScroll } = usePreferencesStore.getState();
    if (viewerSpread) spread.setSpreadMode(SpreadMode.Odd);
    if (viewerScroll === "horizontal") {
      scroll.setScrollStrategy(ScrollStrategy.Horizontal);
      usePageDisplayStore.getState().setScroll(documentId, "horizontal");
    }
    if (viewerZoom === "fitWidth" && !viewerSpread) return;
    const level = zoomLevelFor(viewerZoom);
    LAYOUT_SETTLE_MS.forEach((delay) => window.setTimeout(() => zoom.requestZoom(level), delay));
  }, [documentId, zoom, spread, scroll]);

  return null;
}

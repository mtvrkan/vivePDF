import { ZoomMode } from "@embedpdf/plugin-zoom/react";
import type { ViewerZoom } from "@/shared/store/preferencesStore";

const applied = new Set<string>();

export function markDefaultsApplied(documentId: string): boolean {
  if (applied.has(documentId)) return false;
  applied.add(documentId);
  return true;
}

export function zoomLevelFor(zoom: ViewerZoom): ZoomMode | number {
  if (zoom === "fitPage") return ZoomMode.FitPage;
  if (zoom === "actual") return 1;
  return ZoomMode.FitWidth;
}

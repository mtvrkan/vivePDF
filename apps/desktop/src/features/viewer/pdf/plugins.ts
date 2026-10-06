import { createPluginRegistration } from "@embedpdf/core";
import { DEFAULT_ANNOTATION_AUTHOR } from "../annotationAuthor";
import { DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react";
import { ViewportPluginPackage } from "@embedpdf/plugin-viewport/react";
import { ScrollPluginPackage } from "@embedpdf/plugin-scroll/react";
import { RenderPluginPackage } from "@embedpdf/plugin-render/react";
import { InteractionManagerPluginPackage } from "@embedpdf/plugin-interaction-manager/react";
import { ZoomMode, ZoomPluginPackage } from "@embedpdf/plugin-zoom/react";
import { RotatePluginPackage } from "@embedpdf/plugin-rotate/react";
import { SpreadPluginPackage } from "@embedpdf/plugin-spread/react";
import { TilingPluginPackage } from "@embedpdf/plugin-tiling/react";
import { ThumbnailPluginPackage } from "@embedpdf/plugin-thumbnail/react";
import { SearchPluginPackage } from "@embedpdf/plugin-search/react";
import { SelectionPluginPackage } from "@embedpdf/plugin-selection/react";
import { PrintPluginPackage } from "@embedpdf/plugin-print/react";
import { PanPluginPackage } from "@embedpdf/plugin-pan/react";
import { HistoryPluginPackage } from "@embedpdf/plugin-history/react";
import { AnnotationPluginPackage } from "@embedpdf/plugin-annotation/react";
import { RedactionPluginPackage } from "@embedpdf/plugin-redaction/react";
import { ExportPluginPackage } from "@embedpdf/plugin-export/react";
import { ZOOM_MAX_LEVEL, ZOOM_MIN_LEVEL } from "@/features/viewer/zoomShortcuts";
import { MAX_OPEN_DOCUMENTS } from "@/shared/lib/documentLimit";

const SHAPE_CLICK_SIZE = { width: 100, height: 100 };
const LINE_CLICK_LENGTH = 100;
const ONE_SHOT_SHAPE = { deactivateToolAfterCreate: true, selectAfterCreate: true, editAfterCreate: false };

export const THUMBNAIL_WIDTH = 140;

export const viewerPlugins = [
  createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: MAX_OPEN_DOCUMENTS }),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: 16 }),
  createPluginRegistration(ScrollPluginPackage, { defaultPageGap: 12 }),
  createPluginRegistration(RenderPluginPackage, { withForms: true }),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
    minZoom: ZOOM_MIN_LEVEL,
    maxZoom: ZOOM_MAX_LEVEL,
    zoomRanges: [
      { min: ZOOM_MIN_LEVEL, max: 1, step: 0.1 },
      { min: 1, max: 2, step: 0.25 },
      { min: 2, max: 4, step: 0.5 },
      { min: 4, max: ZOOM_MAX_LEVEL, step: 1 },
    ],
  }),
  createPluginRegistration(RotatePluginPackage),
  createPluginRegistration(SpreadPluginPackage),
  createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 4, extraRings: 0 }),
  createPluginRegistration(ThumbnailPluginPackage, { width: THUMBNAIL_WIDTH }),
  createPluginRegistration(SearchPluginPackage),
  createPluginRegistration(SelectionPluginPackage),
  createPluginRegistration(HistoryPluginPackage),
  createPluginRegistration(AnnotationPluginPackage, {
    annotationAuthor: DEFAULT_ANNOTATION_AUTHOR,
    autoCommit: true,
    tools: [
      { id: "square", clickBehavior: { enabled: false, defaultSize: SHAPE_CLICK_SIZE }, behavior: ONE_SHOT_SHAPE },
      { id: "circle", clickBehavior: { enabled: false, defaultSize: SHAPE_CLICK_SIZE }, behavior: ONE_SHOT_SHAPE },
      { id: "line", clickBehavior: { enabled: false, defaultLength: LINE_CLICK_LENGTH }, behavior: ONE_SHOT_SHAPE },
      { id: "lineArrow", clickBehavior: { enabled: false, defaultLength: LINE_CLICK_LENGTH }, behavior: ONE_SHOT_SHAPE },
      { id: "freeText", behavior: { insertUpright: true, editAfterCreate: true, selectAfterCreate: true, deactivateToolAfterCreate: true } },
    ],
    colorPresets: ["#FFD400", "#FF6B00", "#E5484D", "#D6409F", "#8E4EC6", "#3E63DD", "#0090FF", "#12A594", "#30A46C", "#000000"],
  }),
  createPluginRegistration(RedactionPluginPackage, { useAnnotationMode: true }),
  createPluginRegistration(ExportPluginPackage),
  createPluginRegistration(PrintPluginPackage),
  createPluginRegistration(PanPluginPackage),
];

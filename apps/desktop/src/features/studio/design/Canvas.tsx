import { useCallback, useMemo, useRef, type RefObject, type WheelEvent as ReactWheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "@/components/shared/ContextMenu";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { useDropPositionHandler } from "@/shared/hooks/useDropHandler";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { StudioDesign, StudioPage, StudioSvgElement } from "@/types/studio";
import { graphicOf } from "../graphics/graphicData";
import { TableCanvasEditor } from "../graphics/TableCanvasEditor";
import { guidesOf, marginsOf } from "../model/guides";
import { elementBounds, unionBounds } from "../model/edit";
import { PAD, type Point } from "./canvasGeometry";
import { canvasMenuItems } from "./canvasMenu";
import { HoverOutline, PageFrames, ReadoutTag, SnapLines, SpanMarks } from "./CanvasMarks";
import { CropBar, CropFrame } from "./CropOverlay";
import { useCropStore } from "./cropMode";
import { ElementView, PageView } from "./ElementView";
import { GuideLines } from "./GuideLines";
import { insertImagePaths, isImagePath } from "./imageImport";
import { CanvasRulers, type RulerExtent } from "./Rulers";
import { SelectionOverlay } from "./SelectionOverlay";
import { TextEditor } from "./TextEditor";
import { currentPage, useStudioStore } from "./studioStore";
import { formatMm, fromMm } from "./units";
import { useCanvasPointer } from "./useCanvasPointer";
import { useCanvasViewport } from "./useCanvasViewport";
import { BLEED_MM, useViewPrefs } from "./viewPrefs";

export function Canvas({ language }: { language: string }) {
  const { t } = useTranslation();
  const design = useStudioStore((state) => state.design);
  const page = useStudioStore((state) => currentPage(state));
  const zoom = useStudioStore((state) => state.zoom);
  const fit = useStudioStore((state) => state.fit);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const dropImages = useRef<(paths: string[], position: Point) => boolean>(() => false);
  dropImages.current = (paths, position) => {
    if (!paths.length || !paths.every(isImagePath) || !useStudioStore.getState().design) return false;
    const rect = pageRef.current?.getBoundingClientRect();
    const current = currentPage(useStudioStore.getState());
    const ratio = window.devicePixelRatio || 1;
    const scale = useStudioStore.getState().zoom;
    const point = rect && current ? { x: (position.x / ratio - rect.left) / scale, y: (position.y / ratio - rect.top) / scale } : null;
    const inside = point && current && point.x >= 0 && point.y >= 0 && point.x <= current.width && point.y <= current.height;
    void insertImagePaths(paths, inside ? point : null, (error) => useToastStore.getState().push("error", describeError(t, toRpcError(error))));
    return true;
  };
  const onImageDrop = useCallback((paths: string[], position: Point) => dropImages.current(paths, position), []);
  useDropPositionHandler(onImageDrop);

  useCanvasViewport({ viewportRef, pageRef, zoom, fit, pageWidth: page?.width ?? 0, pageHeight: page?.height ?? 0 });

  if (!design || !page) return null;
  return <CanvasSurface design={design} page={page} zoom={zoom} language={language} viewportRef={viewportRef} pageRef={pageRef} />;
}

type CanvasSurfaceProps = {
  design: StudioDesign;
  page: StudioPage;
  zoom: number;
  language: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  pageRef: RefObject<HTMLDivElement | null>;
};

function CanvasSurface({ design, page, zoom, language, viewportRef, pageRef }: CanvasSurfaceProps) {
  const { t } = useTranslation();
  const selection = useStudioStore((state) => state.selection);
  const editingId = useStudioStore((state) => state.editingId);
  const showRulers = useViewPrefs((state) => state.rulers);
  const showGuides = useViewPrefs((state) => state.guides);
  const showMargins = useViewPrefs((state) => state.margins);
  const showBleed = useViewPrefs((state) => state.bleed);
  const menu = useContextMenu();
  const cropSession = useCropStore((state) => state.session);

  const selected = useMemo(() => (page ? page.elements.filter((element) => selection.includes(element.id)) : []), [page, selection]);
  const number = useMemo(() => (points: number) => formatMm(points, language), [language]);
  const degrees = useMemo(() => {
    const format = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
    return (angle: number) => `${format.format(angle)}°`;
  }, [language]);
  const { feedback, marquee, hover, setHover, turn, movingGuide, panReady, panning, onPointerDown, onPointerMove, onPointerUp, onDoubleClick, rulerHandlers } = useCanvasPointer({ viewportRef, pageRef, page, zoom, number, degrees });

  const onContextMenu = (event: React.MouseEvent) => {
    const hit = (event.target as HTMLElement).closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    if (hit && !useStudioStore.getState().selection.includes(hit)) useStudioStore.getState().select([hit]);
    menu.open(event);
  };

  const showHandles = !editingId && !cropSession && selected.length > 0 && selected.some((element) => !element.locked);
  const pageLeft = `max(${PAD}px, calc(50% - ${(page.width * zoom) / 2}px))`;
  const guides = showGuides ? guidesOf(page) : [];
  const selectionBox = selected.length ? unionBounds(selected.map(elementBounds)) : null;
  const extent: RulerExtent = selectionBox ? { x: [selectionBox.x, selectionBox.x + selectionBox.width], y: [selectionBox.y, selectionBox.y + selectionBox.height] } : null;
  const hovered = hover && !editingId && !selection.includes(hover) ? page.elements.find((element) => element.id === hover && !element.hidden) : undefined;
  const hoverBox = hovered?.groupId ? unionBounds(page.elements.filter((element) => element.groupId === hovered.groupId && !element.hidden).map(elementBounds)) : null;

  return (
    <div className="relative min-h-0 flex-1">
      {showRulers ? <CanvasRulers viewportRef={viewportRef} pageRef={pageRef} zoom={zoom} pageWidth={page.width} pageHeight={page.height} extent={extent} language={language} handlers={rulerHandlers} /> : null}
      <div
        ref={viewportRef}
        data-testid="studio-viewport"
        className={cn("absolute bottom-0 right-0 overflow-auto bg-muted/40", showRulers ? "left-6 top-6" : "left-0 top-0", panning ? "cursor-grabbing" : panReady && "cursor-grab")}
        onPointerDown={onPointerDown}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onWheelCapture={(event: ReactWheelEvent) => {
          if (event.ctrlKey) event.stopPropagation();
        }}
      >
        <div style={{ position: "relative", width: `${page.width * zoom + PAD * 2}px`, height: `${page.height * zoom + PAD * 2}px`, minWidth: "100%", minHeight: "100%" }}>
          <div
            ref={pageRef}
            role="region"
            aria-label={t("studio.canvas.label")}
            className="absolute shadow-lg"
            style={{ left: pageLeft, top: `${PAD}px`, width: `${page.width * zoom}px`, height: `${page.height * zoom}px` }}
          >
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", width: `${page.width}px`, height: `${page.height}px` }}>
              <PageView
                page={page}
                language={language}
                renderElement={(element) =>
                  element.id === editingId && element.kind === "text" ? (
                    <ElementView key={element.id} element={{ ...element, flipX: false, flipY: false }} language={language}>
                      <TextEditor element={element} language={language} />
                    </ElementView>
                  ) : element.id === editingId && graphicOf(element)?.kind === "table" ? (
                    <ElementView key={element.id} element={element} language={language}>
                      <TableCanvasEditor element={element as StudioSvgElement} />
                    </ElementView>
                  ) : (
                    <ElementView key={element.id} element={cropSession?.elementId === element.id ? { ...element, opacity: 0 } : element} language={language} />
                  )
                }
              />
            </div>
            <div className="pointer-events-none absolute inset-0 z-20">
              <PageFrames width={page.width} height={page.height} margin={showMargins ? fromMm(marginsOf(design)) : 0} bleed={showBleed ? fromMm(BLEED_MM) : 0} zoom={zoom} />
              {hovered ? <HoverOutline box={hoverBox ?? { x: hovered.x, y: hovered.y, width: hovered.width, height: hovered.height }} rotation={hoverBox ? 0 : hovered.rotation} zoom={zoom} /> : null}
              <SelectionOverlay selected={selected} zoom={zoom} turn={turn} showHandles={showHandles} cropping={Boolean(cropSession)} />
              <SnapLines lines={feedback.lines} zoom={zoom} />
              <SpanMarks spans={feedback.distances} zoom={zoom} format={number} emphasis={false} />
              <SpanMarks spans={feedback.gaps} zoom={zoom} format={number} emphasis />
              {marquee ? <div className="absolute border border-primary bg-primary/10" style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.width * zoom, height: marquee.height * zoom }} /> : null}
              {feedback.readout ? <ReadoutTag readout={feedback.readout} zoom={zoom} /> : null}
              <CropFrame zoom={zoom} />
            </div>
          </div>
          <GuideLines guides={guides} pageLeft={pageLeft} zoom={zoom} movingGuide={movingGuide} />
        </div>
      </div>
      <CropBar />
      {menu.anchor ? <ContextMenu anchor={menu.anchor} items={canvasMenuItems(t, selection, selected)} label={t("studio.menu.label")} onClose={menu.close} /> : null}
    </div>
  );
}

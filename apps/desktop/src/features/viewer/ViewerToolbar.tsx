import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Camera,
  Copy,
  Hand,
  Maximize,
  Minimize,
  Printer,
  RotateCw,
  Search,
  ScanText,
  SquareDashedMousePointer,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { ZoomMode, useZoom } from "@embedpdf/plugin-zoom/react";
import { useRotate } from "@embedpdf/plugin-rotate/react";
import { usePan } from "@embedpdf/plugin-pan/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { useDocumentSave } from "./useDocumentSave";
import { useUnsavedMarks } from "./useUnsavedMarks";
import { usePrintDialogStore } from "@/shared/store/printDialogStore";
import type { ViewerPanels } from "@/shared/store/viewerPanelsStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { setImmersiveFullscreen } from "./immersive";
import { copySelection } from "./copySelection";
import { ZoomInput } from "./ZoomInput";
import { PageDisplayMenu } from "./PageDisplayMenu";
import { cn } from "@/shared/lib/cn";
import { pageFromInput, pageLabelOf } from "@/shared/lib/pageLabels";
import { usePageLabels } from "@/shared/store/pageLabelsStore";
import { usePageNavigation } from "./usePageNavigation";

type ViewerToolbarProps = {
  documentId: string;
  panels: ViewerPanels;
  onTogglePanel: (panel: keyof ViewerPanels) => void;
};

const ZOOM_PRESETS = [0.5, 0.75, 1.25, 1.5, 2, 3, 4];
const MARQUEE_DRAG_THRESHOLD_PX = 6;
const PRIMARY_BUTTON = 0;

export function ViewerToolbar({ documentId, panels, onTogglePanel }: ViewerToolbarProps) {
  const { t } = useTranslation();
  const overlayMode = useViewerOverlayStore((state) => state.mode);
  const setOverlayMode = useViewerOverlayStore((state) => state.setMode);
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const { state: zoomState, provides: zoom } = useZoom(documentId);
  const { provides: rotate } = useRotate(documentId);
  const openPrintDialog = usePrintDialogStore((state) => state.setOpen);
  const { provides: pan, isPanning } = usePan(documentId);
  const { provides: selection } = useSelectionCapability();
  const queuedChanges = usePendingChangesStore((state) => pendingChangesFor(state.changes, documentId));
  const { save, discard } = useDocumentSave(documentId);
  const hasMarkChanges = useUnsavedMarks(documentId);
  const [savingDocument, setSavingDocument] = useState(false);
  const { jumpTo, goBack, goForward, canGoBack, canGoForward } = usePageNavigation(documentId);

  const unsavedCount = (hasMarkChanges ? 1 : 0) + queuedChanges.length;

  const runSave = async () => {
    setSavingDocument(true);
    try {
      await save();
    } finally {
      setSavingDocument(false);
    }
  };

  const runDiscard = () => {
    discard();
  };
  const labels = usePageLabels(documentId);
  const currentLabel = pageLabelOf(labels, scrollState.currentPage);
  const [pageInput, setPageInput] = useState(currentLabel);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setPageInput(currentLabel);
  }, [currentLabel]);

  useEffect(() => {
    void getCurrentWindow().isFullscreen().then(setFullscreen);
  }, []);

  useEffect(() => {
    if (!zoomState.isMarqueeZoomActive) return;
    let origin: { x: number; y: number } | null = null;
    let offTimer: number | null = null;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      origin = event.button === PRIMARY_BUTTON && target?.closest("[data-pan-scroller]") ? { x: event.clientX, y: event.clientY } : null;
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = origin;
      origin = null;
      if (!start || event.button !== PRIMARY_BUTTON) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < MARQUEE_DRAG_THRESHOLD_PX) return;
      offTimer = window.setTimeout(() => zoom?.disableMarqueeZoom(), 0);
    };
    const onPointerCancel = () => {
      origin = null;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      if (offTimer !== null) window.clearTimeout(offTimer);
    };
  }, [zoomState.isMarqueeZoomActive, zoom]);

  const goToPage = () => {
    const page = pageFromInput(pageInput, labels, scrollState.totalPages);
    if (page !== null && page !== scrollState.currentPage) jumpTo(page);
    else setPageInput(currentLabel);
  };

  const toggleFullscreen = async () => {
    const next = !(await getCurrentWindow().isFullscreen());
    await setImmersiveFullscreen(next);
    setFullscreen(next);
  };

  const zoomPercent = Math.round(zoomState.currentZoomLevel * 100);

  return (
    <div className="relative z-40 flex h-topbar flex-nowrap items-center gap-1 glass-flat border-b px-2">
      <IconButton icon={Search} label={t("viewer.search")} active={panels.search} onClick={() => onTogglePanel("search")} />
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />

      <IconButton icon={ArrowLeft} label={t("viewer.navigateBack")} disabled={!canGoBack} onClick={goBack} />
      <IconButton icon={ArrowRight} label={t("viewer.navigateForward")} disabled={!canGoForward} onClick={goForward} />
      <IconButton
        icon={ChevronLeft}
        label={t("viewer.previousPage")}
        disabled={scrollState.currentPage <= 1}
        onClick={() => scroll?.scrollToPreviousPage()}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          goToPage();
        }}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-sm tabular-nums"
      >
        <input
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onBlur={goToPage}
          aria-label={t("viewer.pageNumber")}
          inputMode={labels ? "text" : "numeric"}
          className={cn("field-inline h-7 rounded-md text-center", labels ? "w-14" : "w-12")}
        />
        <span className="text-muted-foreground">{labels ? `(${scrollState.currentPage} / ${scrollState.totalPages})` : `/ ${scrollState.totalPages}`}</span>
      </form>
      <IconButton
        icon={ChevronRight}
        label={t("viewer.nextPage")}
        disabled={scrollState.currentPage >= scrollState.totalPages}
        onClick={() => scroll?.scrollToNextPage()}
      />
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />

      {unsavedCount > 0 ? (
        <div className="glass-chip flex h-7 shrink-0 items-center gap-1 rounded-full ps-2.5 pe-1 text-xs" data-tone="warning">
          <span className="whitespace-nowrap font-medium">{t("viewer.save.unsaved")}</span>
          <button
            type="button"
            onClick={() => void runSave()}
            disabled={savingDocument}
            className="h-5 whitespace-nowrap rounded-full bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
          >
            {t("viewer.save.save")}
          </button>
          <IconButton icon={X} label={t("viewer.save.discard")} disabled={savingDocument} onClick={runDiscard} />
        </div>
      ) : null}

      <IconButton
        icon={ScanText}
        label={t("viewer.areaText.tool")}
        active={overlayMode === "areaText"}
        onClick={() => {
          if (zoomState.isMarqueeZoomActive) zoom?.disableMarqueeZoom();
          setOverlayMode(overlayMode === "areaText" ? null : "areaText");
        }}
      />
      <IconButton
        icon={Camera}
        label={t("viewer.snapshot.tool")}
        active={overlayMode === "snapshot"}
        onClick={() => {
          if (zoomState.isMarqueeZoomActive) zoom?.disableMarqueeZoom();
          setOverlayMode(overlayMode === "snapshot" ? null : "snapshot");
        }}
      />
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />

      <IconButton icon={RotateCw} label={t("viewer.rotate")} onClick={() => rotate?.rotateForward()} />
      <PageDisplayMenu documentId={documentId} />
      <IconButton icon={Hand} label={t("viewer.pan")} active={isPanning} onClick={() => pan?.togglePan()} />
      <IconButton
        icon={Copy}
        label={t("viewer.copy")}
        onClick={() => void copySelection(selection?.forDocument(documentId))}
      />
      <IconButton icon={Printer} label={t("viewer.print")} onClick={() => openPrintDialog(true)} />

      <span className="flex-1" />
      <IconButton icon={ZoomOut} label={t("viewer.zoomOut")} onClick={() => zoom?.zoomOut()} />
      <ZoomInput percent={zoomPercent} label={t("viewer.zoomInput")} onApply={(percent) => zoom?.requestZoom(percent / 100)} />
      <IconButton icon={ZoomIn} label={t("viewer.zoomIn")} onClick={() => zoom?.zoomIn()} />
      <Select
        size="sm"
        ariaLabel={t("viewer.zoom")}
        className="w-28"
        value=""
        placeholder={t("viewer.zoomMenu")}
        options={[
          { value: "fit-width", label: t("viewer.fitWidth") },
          { value: "fit-page", label: t("viewer.fitPage") },
          { value: "actual", label: t("viewer.actualSize") },
          ...ZOOM_PRESETS.map((preset) => ({ value: String(preset), label: `${Math.round(preset * 100)}%` })),
        ]}
        onChange={(value) => {
          if (value === "fit-width") zoom?.requestZoom(ZoomMode.FitWidth);
          else if (value === "fit-page") zoom?.requestZoom(ZoomMode.FitPage);
          else if (value === "actual") zoom?.requestZoom(1);
          else zoom?.requestZoom(Number(value));
        }}
      />
      <IconButton icon={SquareDashedMousePointer} label={t("viewer.areaZoom")} active={zoomState.isMarqueeZoomActive} onClick={() => zoom?.toggleMarqueeZoom()} />
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <IconButton
        icon={fullscreen ? Minimize : Maximize}
        label={t("viewer.fullscreen")}
        active={fullscreen}
        onClick={() => void toggleFullscreen()}
      />
    </div>
  );
}

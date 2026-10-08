import { useEffect, useState } from "react";
import {
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
import { switchOverlayMode } from "./overlay/editorModes";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { setImmersiveFullscreen } from "./immersive";
import { copySelection } from "./copySelection";
import { ZoomInput } from "./ZoomInput";
import { PageDisplayMenu } from "./PageDisplayMenu";

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
  const { state: zoomState, provides: zoom } = useZoom(documentId);
  const { provides: rotate } = useRotate(documentId);
  const openPrintDialog = usePrintDialogStore((state) => state.setOpen);
  const { provides: pan, isPanning } = usePan(documentId);
  const { provides: selection } = useSelectionCapability();
  const queuedChanges = usePendingChangesStore((state) => pendingChangesFor(state.changes, documentId));
  const { save, discard } = useDocumentSave(documentId);
  const hasMarkChanges = useUnsavedMarks(documentId);
  const [savingDocument, setSavingDocument] = useState(false);

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
  const [fullscreen, setFullscreen] = useState(false);

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

      {unsavedCount > 0 ? (
        <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 ps-2.5 pe-0.5 text-xs">
          <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="whitespace-nowrap font-medium text-foreground">{t("viewer.save.unsaved")}</span>
          <button
            type="button"
            onClick={() => void runSave()}
            disabled={savingDocument}
            className="ms-0.5 flex h-6 items-center whitespace-nowrap rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground outline-none transition-colors duration-(--transition-fast) hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-40"
          >
            {t("viewer.save.save")}
          </button>
          <button
            type="button"
            onClick={runDiscard}
            disabled={savingDocument}
            aria-label={t("viewer.save.discard")}
            title={t("viewer.save.discard")}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-(--transition-fast) hover:bg-primary/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <IconButton
        icon={ScanText}
        label={t("viewer.areaText.tool")}
        active={overlayMode === "areaText"}
        onClick={() => {
          if (zoomState.isMarqueeZoomActive) zoom?.disableMarqueeZoom();
          switchOverlayMode(overlayMode === "areaText" ? null : "areaText");
        }}
      />
      <IconButton
        icon={Camera}
        label={t("viewer.snapshot.tool")}
        active={overlayMode === "snapshot"}
        onClick={() => {
          if (zoomState.isMarqueeZoomActive) zoom?.disableMarqueeZoom();
          switchOverlayMode(overlayMode === "snapshot" ? null : "snapshot");
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

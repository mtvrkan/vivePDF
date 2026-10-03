import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Clock, Code2, Grid3x3, Minimize, Moon, Settings, Sun, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { PresentationStyleControls, PresentationStyleTrigger, PresentationToolButtons } from "./presentation/PresentationTools";
import { hasStyleOptions } from "./presentation/toolPresets";
import { TimerClockChip } from "./presentation/TimerClockChip";
import { DrawingCleanupButton, TemporaryDrawingCleanup } from "./presentation/DrawingCleanupButton";
import type { SessionAnnotation } from "./sessionAnnotations";
import { useCodeBlocksForPage } from "./presentation/useCodeBlocks";

const HIDE_DELAY_MS = 2500;

export function PresenterBar({
  documentId,
  onExit,
  onManualZoom,
  sessionAnnotations,
  onClearSessionAnnotations,
}: {
  documentId: string;
  onExit: () => void;
  onManualZoom: () => void;
  sessionAnnotations: SessionAnnotation[];
  onClearSessionAnnotations: (pageIndex?: number) => void;
}) {
  const { t } = useTranslation();
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const { state: zoomState, provides: zoom } = useZoom(documentId);
  const [pageInput, setPageInput] = useState(String(scrollState.currentPage));
  const [visible, setVisible] = useState(true);
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmAnnotations, setConfirmAnnotations] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const tool = usePresentationStore((state) => state.tool);
  const blackout = usePresentationStore((state) => state.blackout);
  const toggleBlackout = usePresentationStore((state) => state.toggleBlackout);
  const toggleOverview = usePresentationStore((state) => state.toggleOverview);
  const showClock = usePresentationStore((state) => state.showClock);
  const showTimer = usePresentationStore((state) => state.showTimer);
  const toggleClock = usePresentationStore((state) => state.toggleClock);
  const toggleTimerVisible = usePresentationStore((state) => state.toggleTimerVisible);
  const cursorAutoHide = usePresentationStore((state) => state.cursorAutoHide);
  const toggleCursorAutoHide = usePresentationStore((state) => state.toggleCursorAutoHide);
  const drawingsMode = usePresentationStore((state) => state.drawingsMode);
  const setDrawingsMode = usePresentationStore((state) => state.setDrawingsMode);
  const codeBlocks = useCodeBlocksForPage(documentId, scrollState.currentPage - 1);

  useEffect(() => {
    setPageInput(String(scrollState.currentPage));
  }, [scrollState.currentPage]);

  const scheduleHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_DELAY_MS);
  };

  useEffect(() => {
    const onMove = () => {
      setVisible(true);
      scheduleHide();
    };
    window.addEventListener("mousemove", onMove);
    scheduleHide();
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const goToPage = () => {
    const page = Number.parseInt(pageInput, 10);
    if (Number.isFinite(page) && page >= 1 && page <= scrollState.totalPages) scroll?.scrollToPage({ pageNumber: page });
    else setPageInput(String(scrollState.currentPage));
  };

  const manualZoom = (action: () => void) => {
    onManualZoom();
    action();
  };

  const showStylePopover = hasStyleOptions(tool);

  return (
    <>
      <div
        onMouseEnter={() => {
          if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
          setVisible(true);
        }}
        onMouseLeave={scheduleHide}
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center transition-[opacity,transform] duration-200",
          visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
      >
        <div className="glass pointer-events-auto flex h-12 items-center gap-1 rounded-full px-2">
          <IconButton icon={ChevronLeft} label={t("viewer.previousPage")} disabled={scrollState.currentPage <= 1} onClick={() => scroll?.scrollToPreviousPage()} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              goToPage();
            }}
            className="flex items-center gap-1 font-mono text-sm tabular-nums"
          >
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={goToPage}
              aria-label={t("viewer.pageNumber")}
              inputMode="numeric"
              className="field h-7 w-11 rounded-lg text-center"
            />
            <span className="text-muted-foreground">/ {scrollState.totalPages}</span>
          </form>
          <IconButton icon={ChevronRight} label={t("viewer.nextPage")} disabled={scrollState.currentPage >= scrollState.totalPages} onClick={() => scroll?.scrollToNextPage()} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <PresentationToolButtons
            onSelect={(next) => {
              if (!hasStyleOptions(next)) setStylePopoverOpen(false);
            }}
          />
          <IconButton
            icon={ZoomIn}
            label={t("presentation.areaZoom")}
            active={zoomState.isMarqueeZoomActive}
            onClick={() => {
              onManualZoom();
              zoom?.toggleMarqueeZoom();
            }}
          />
          <PresentationStyleTrigger open={stylePopoverOpen} onToggle={() => setStylePopoverOpen((current) => !current)} />
          {drawingsMode === "annotations" ? (
            <DrawingCleanupButton
              pageCount={sessionAnnotations.filter((item) => item.pageIndex === scrollState.currentPage - 1).length}
              totalCount={sessionAnnotations.length}
              onClearPage={() => onClearSessionAnnotations(scrollState.currentPage - 1)}
              onClearAll={() => onClearSessionAnnotations()}
            />
          ) : (
            <TemporaryDrawingCleanup pageIndex={scrollState.currentPage - 1} />
          )}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <IconButton icon={ZoomOut} label={t("viewer.zoomOut")} onClick={() => manualZoom(() => zoom?.zoomOut())} />
          <span className="w-11 text-center font-mono text-xs tabular-nums text-muted-foreground">{Math.round(zoomState.currentZoomLevel * 100)}%</span>
          <IconButton icon={ZoomIn} label={t("viewer.zoomIn")} onClick={() => manualZoom(() => zoom?.zoomIn())} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <IconButton icon={Moon} label={t("presentation.blackoutBlack")} active={blackout === "black"} onClick={() => toggleBlackout("black")} />
          <IconButton icon={Sun} label={t("presentation.blackoutWhite")} active={blackout === "white"} onClick={() => toggleBlackout("white")} />
          <IconButton icon={Grid3x3} label={t("presentation.overview")} onClick={toggleOverview} />
          {codeBlocks && codeBlocks.blocks.length > 0 ? (
            <span className="glass-chip flex h-7 items-center gap-1 rounded-full px-2 font-mono text-[11px] text-primary">
              <Code2 className="size-3" aria-hidden />
              {codeBlocks.blocks.length}
            </span>
          ) : null}
          <IconButton icon={Clock} label={t("presentation.toggleTimer")} active={showTimer} onClick={toggleTimerVisible} />
          <IconButton icon={Calendar} label={t("presentation.toggleClock")} active={showClock} onClick={toggleClock} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <IconButton icon={Settings} label={t("presentation.settings")} active={settingsOpen} onClick={() => setSettingsOpen((current) => !current)} />
          <IconButton icon={Minimize} label={t("viewer.exitFullscreen")} onClick={onExit} />
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-20 right-4 z-30 flex justify-end">
        <TimerClockChip />
      </div>

      {showStylePopover && stylePopoverOpen ? (
        <div className="glass select-pop origin-bottom pointer-events-auto fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-2xl p-3">
          <PresentationStyleControls />
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="glass select-pop origin-bottom pointer-events-auto fixed bottom-20 right-4 z-30 w-64 rounded-2xl p-3">
          <label className="flex items-center justify-between gap-2 py-1.5 text-sm">
            {t("presentation.cursorAutoHide")}
            <input type="checkbox" checked={cursorAutoHide} onChange={toggleCursorAutoHide} />
          </label>
          <label className="flex items-center justify-between gap-2 py-1.5 text-sm">
            {t("presentation.saveAsAnnotations")}
            <input
              type="checkbox"
              checked={drawingsMode === "annotations"}
              onChange={(event) => (event.target.checked ? setConfirmAnnotations(true) : setDrawingsMode("temporary"))}
            />
          </label>
        </div>
      ) : null}

      <Dialog
        open={confirmAnnotations}
        title={t("presentation.confirmAnnotationsTitle")}
        onClose={() => setConfirmAnnotations(false)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmAnnotations(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setDrawingsMode("annotations");
                setConfirmAnnotations(false);
              }}
            >
              {t("presentation.confirmAnnotationsAction")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("presentation.confirmAnnotationsBody")}</p>
      </Dialog>
    </>
  );
}

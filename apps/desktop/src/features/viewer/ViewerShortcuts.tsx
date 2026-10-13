import { useEffect } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { useRedaction } from "@embedpdf/plugin-redaction/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { ZoomMode, useZoom } from "@embedpdf/plugin-zoom/react";
import { claimSystemPaste, expectSystemPaste } from "@/shared/lib/systemPaste";
import { shortcutLetter } from "@/shared/lib/shortcutKeys";
import { isTextEntryTarget, isTypingTarget } from "@/shared/lib/typingTarget";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePrintDialogStore } from "@/shared/store/printDialogStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { clearWithUndo } from "./presentation/drawingCleanup";
import { PRESENTATION_TOOLS } from "./presentation/toolPresets";
import { useUiStore } from "@/shared/store/uiStore";
import { EDITOR_MODES, useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { useSplitViewStore } from "@/shared/store/splitViewStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { copySelection } from "./copySelection";
import { holdsEditorObject, useEditorClipboard } from "./overlay/editorClipboard";
import { openEditorAndPaste } from "./overlay/editorPaste";
import { useMarkToolStore } from "./markArea";
import { hasOpenModal, hasTextSelectionOutsidePages, isActivatableTarget, isInsideCompositeWidget } from "./viewerKeyTarget";
import { isSplitViewToggle } from "./split/splitShortcut";
import { usePageNavigation } from "./usePageNavigation";
import { zoomShortcutFor } from "./zoomShortcuts";
import { redoStep, undoStep } from "./linkedHistory";

function editingHere(documentId: string): boolean {
  const overlay = useViewerOverlayStore.getState();
  return overlay.mode !== null && EDITOR_MODES.includes(overlay.mode) && overlay.editingDocumentId === documentId;
}

export function ViewerShortcuts({ documentId }: { documentId: string }) {
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { provides: scroll, state: scrollState } = useScroll(documentId);
  const { provides: annotation } = useAnnotation(documentId);
  const { provides: historyCapability } = useHistoryCapability();
  const { provides: redaction } = useRedaction(documentId);
  const { provides: selectionCapability } = useSelectionCapability();
  const immersive = useUiStore((state) => state.immersive);
  const { goBack, goForward } = usePageNavigation(documentId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);
      const textEntry = isTextEntryTarget(event.target);
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key;
      if (hasOpenModal()) return;

      if (modifier && key.toLowerCase() === "p") {
        event.preventDefault();
        usePrintDialogStore.getState().setOpen(true);
        return;
      }
      const zoomShortcut = zoomShortcutFor(event);
      if (zoomShortcut) {
        event.preventDefault();
        if (zoomShortcut === "in") zoom?.zoomIn();
        else if (zoomShortcut === "out") zoom?.zoomOut();
        else if (zoomShortcut === "actualSize") zoom?.requestZoom(1);
        else if (zoomShortcut === "fitWidth") zoom?.requestZoom(ZoomMode.FitWidth);
        else zoom?.requestZoom(ZoomMode.FitPage);
        return;
      }
      if (textEntry) return;
      if (isSplitViewToggle(event) && !immersive) {
        event.preventDefault();
        const path = useDocumentStore.getState().documents[documentId]?.path;
        if (path) useSplitViewStore.getState().toggle(path);
        return;
      }
      if (event.altKey && !modifier && !event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
        event.preventDefault();
        if (key === "ArrowLeft") goBack();
        else goForward();
        return;
      }
      if (!modifier && (event.defaultPrevented || isInsideCompositeWidget(event.target))) return;

      const presenting = immersive || useViewerPanelsStore.getState().panels.present;
      if (presenting && !modifier && !event.altKey) {
        const presentation = usePresentationStore.getState();
        const letter = shortcutLetter(event);
        const pickedDrawing = presentation.tool === "select" ? presentation.selectedDrawing : null;
        const toolEntry = letter ? PRESENTATION_TOOLS.find((entry) => entry.shortcut?.toLowerCase() === letter) : undefined;
        if (pickedDrawing && (key === "Delete" || key === "Backspace")) {
          event.preventDefault();
          presentation.removeDrawing(pickedDrawing.surface, pickedDrawing.id);
          return;
        }
        if (letter === "e" && event.shiftKey) {
          if (!immersive || presentation.drawingsMode === "temporary") {
            event.preventDefault();
            if (presentation.visibleStrokeCount(scrollState.currentPage - 1) > 0) clearWithUndo(() => presentation.clearVisible(scrollState.currentPage - 1));
          }
        } else if (toolEntry) {
          event.preventDefault();
          presentation.setTool(presentation.tool === toolEntry.id ? "pointer" : toolEntry.id);
        } else if (immersive && presentation.codeBlockOpen && letter === "k") {
          event.preventDefault();
          const pageIndex = presentation.codeBlockOpen.pageIndex;
          const entry = presentation.codeBlocksByPage[pageIndex];
          if (entry && entry.blocks.length > 0) {
            const currentIndex = entry.blocks.findIndex((block) => block.id === presentation.codeBlockOpen?.blockId);
            const next = entry.blocks[(currentIndex + 1) % entry.blocks.length];
            presentation.openCodeBlock(pageIndex, next.id);
          }
        } else if (immersive && letter === "k") {
          event.preventDefault();
          const pageIndex = scrollState.currentPage - 1;
          const entry = presentation.codeBlocksByPage[pageIndex];
          if (entry && entry.blocks.length > 0) presentation.openCodeBlock(pageIndex, entry.blocks[0].id);
        } else if (immersive && letter === "z") {
          event.preventDefault();
          zoom?.toggleMarqueeZoom();
        } else if (immersive && (letter === "b" || key === ".")) {
          event.preventDefault();
          presentation.toggleBlackout("black");
        } else if (immersive && letter === "w") {
          event.preventDefault();
          presentation.toggleBlackout("white");
        } else if (immersive && letter === "g") {
          event.preventDefault();
          presentation.toggleOverview();
        } else if (immersive && letter === "t") {
          event.preventDefault();
          if (!presentation.showTimer) presentation.toggleTimerVisible();
          presentation.toggleTimerRunning();
        } else if (immersive && letter === "c") {
          event.preventDefault();
          presentation.toggleClock();
        }
      }

      if (modifier && key.toLowerCase() === "c" && selectionCapability && !hasTextSelectionOutsidePages()) {
        const scope = selectionCapability.forDocument(documentId);
        if (scope.getState().selection) {
          event.preventDefault();
          void copySelection(scope);
          return;
        }
      }
      if (modifier && !event.shiftKey && !event.altKey && key.toLowerCase() === "v" && !immersive && !editingHere(documentId) && useEditorClipboard.getState().entry) {
        const pageIndex = scrollState.currentPage - 1;
        expectSystemPaste(() => openEditorAndPaste(documentId, pageIndex, null));
        return;
      }
      if (key === "Escape" && zoomState.isMarqueeZoomActive) {
        zoom?.disableMarqueeZoom();
        return;
      }

      if (!immersive && !modifier && useViewerPanelsStore.getState().panels.reading) return;
      const overlay = useViewerOverlayStore.getState();
      if (overlay.mode && (overlay.selectedObjectId || overlay.editingObjectId)) return;
      if (typing && !modifier) return;
      const selectedAnnotation = annotation?.getSelectedAnnotation() ?? null;
      const activatable = isActivatableTarget(event.target);
      const flipForward = immersive && !activatable && (key === "ArrowDown" || key === " " || key === "Enter");
      const flipBackward = immersive && (key === "ArrowUp" || (key === "Backspace" && !selectedAnnotation));
      if (key === "PageDown" || key === "ArrowRight" || flipForward) {
        event.preventDefault();
        if (scrollState.currentPage < scrollState.totalPages) scroll?.scrollToNextPage();
        return;
      }
      if (key === "PageUp" || key === "ArrowLeft" || flipBackward) {
        event.preventDefault();
        if (scrollState.currentPage > 1) scroll?.scrollToPreviousPage();
        return;
      }
      if (key === "Home") {
        event.preventDefault();
        scroll?.scrollToPage({ pageNumber: 1, behavior: "instant" });
        return;
      }
      if (key === "End") {
        event.preventDefault();
        scroll?.scrollToPage({ pageNumber: scrollState.totalPages, behavior: "instant" });
        return;
      }

      const history = historyCapability?.forDocument(documentId);
      const presentationState = usePresentationStore.getState();
      const useDrawingHistory = immersive ? presentationState.drawingsMode === "temporary" : useViewerPanelsStore.getState().panels.present;
      if (modifier && key.toLowerCase() === "z") {
        event.preventDefault();
        const pageIndex = scrollState.currentPage - 1;
        if (useDrawingHistory) {
          if (event.shiftKey) presentationState.redoStroke(pageIndex);
          else presentationState.undoStroke(pageIndex);
        } else if (event.shiftKey) redoStep(documentId, history, annotation);
        else undoStep(documentId, history, annotation);
        return;
      }
      if (modifier && key.toLowerCase() === "y") {
        event.preventDefault();
        if (useDrawingHistory) presentationState.redoStroke(scrollState.currentPage - 1);
        else redoStep(documentId, history, annotation);
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        if (selectedAnnotation && annotation) {
          event.preventDefault();
          annotation.deleteAnnotations(annotation.getSelectedAnnotations().map(({ object }) => ({ pageIndex: object.pageIndex, id: object.id })));
        }
        return;
      }
      if (key === "Escape") {
        useMarkToolStore.getState().stop();
        if (annotation?.getActiveTool()) annotation.setActiveTool(null);
        if (redaction?.isRedactActive()) redaction.toggleRedact();
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const entry = useEditorClipboard.getState().entry;
      if (!entry || editingHere(documentId) || !claimSystemPaste()) return;
      if (!holdsEditorObject(event.clipboardData, entry)) return;
      event.preventDefault();
      openEditorAndPaste(documentId, scrollState.currentPage - 1, null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [documentId, zoom, zoomState.isMarqueeZoomActive, scroll, scrollState.currentPage, scrollState.totalPages, annotation, historyCapability, redaction, selectionCapability, immersive, goBack, goForward]);

  return null;
}

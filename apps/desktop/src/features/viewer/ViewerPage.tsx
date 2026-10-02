import { useEffect, useRef } from "react";
import { FileText, Highlighter, Maximize, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocumentContent } from "@embedpdf/plugin-document-manager/react";
import { DocumentEmptyState } from "@/components/shared/DocumentEmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";
import { hasLayers, useLayerViewStore } from "@/shared/store/layerViewStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useOpenStore } from "@/shared/store/openStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { togglePageColors, useReadingStore } from "@/shared/store/readingStore";
import { useSearchRequestStore } from "@/shared/store/searchRequestStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { EDITOR_MODES, useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { AnnotateBar } from "./AnnotateBar";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { DocumentMessageBar } from "./DocumentMessageBar";
import { FallbackFontMessages } from "./FallbackFontMessages";
import { SignaturesPanel } from "./SignaturesPanel";
import { LayersPanel } from "./LayersPanel";
import { useLayerCheck } from "./useLayerCheck";
import { CommentsPanel } from "./CommentsPanel";
import { TranslatePanel } from "./TranslatePanel";
import { OverlayBar } from "./overlay/OverlayBar";
import { isPendingChange } from "./overlay/pending";
import { DocumentTabs } from "./DocumentTabs";
import { EditPanel } from "./overlay/EditPanel";
import { ImmersiveView } from "./ImmersiveView";
import { exitImmersive, setImmersiveFullscreen } from "./immersive";
import { Inspector } from "./Inspector";
import { OutlinePanel } from "./OutlinePanel";
import { PendingJump } from "./PendingJump";
import { ReadingPositionTracker } from "./ReadingPositionTracker";
import { PresentationBar } from "./presentation/PresentationBar";
import { PresentationCanvas } from "./presentation/PresentationCanvas";
import { PrintDialog } from "./PrintDialog";
import { ReadAloudBar } from "./ReadAloudBar";
import { ReadingView } from "./ReadingView";
import { SearchBar } from "./SearchBar";
import { useSearchBarState } from "./search/useSearchBarState";
import { SelectionActions } from "./SelectionActions";
import { AreaTextPopover } from "./overlay/AreaTextPopover";
import { SnapshotTaker } from "./overlay/SnapshotTaker";
import { AutoScroller } from "./AutoScroller";
import { PageColorFilters } from "./PageColorFilters";
import { MakeSearchableDialog } from "./MakeSearchableDialog";
import { requestSearchable } from "./searchableStore";
import { SpeechStatusBar } from "./SpeechStatusBar";
import { SplitStage } from "./split/SplitStage";
import { ThumbnailSidebar } from "./ThumbnailSidebar";
import { ViewerDefaults } from "./ViewerDefaults";
import { ViewerShortcuts } from "./ViewerShortcuts";
import { ViewerToolbar } from "./ViewerToolbar";
import { NavigationRail, ToolsRail } from "./ViewerRails";
import { useOpenPdf } from "./useOpenPdf";
import { useCloseDocuments } from "./useCloseDocuments";
import { useLiveActiveDocument } from "./useLiveActiveDocument";

export function ViewerPage() {
  const { t } = useTranslation();
  const { activeDocumentId } = useLiveActiveDocument();
  const document = useDocumentStore((state) => (activeDocumentId ? (state.documents[activeDocumentId] ?? null) : null));
  const { pickAndOpen, openPath, closeDocument } = useOpenPdf();
  const { closeDocuments } = useCloseDocuments();
  const awaitingPassword = useOpenStore((state) => state.passwordRequest?.documentId === activeDocumentId);
  const stageRef = useRef<HTMLDivElement>(null);
  const panels = useViewerPanelsStore((state) => state.panels);
  const setPanels = useViewerPanelsStore((state) => state.setPanels);
  const togglePanel = useViewerPanelsStore((state) => state.toggle);
  const immersive = useUiStore((state) => state.immersive);
  const pageColors = useReadingStore((state) => state.pageColors);
  const overlayMode = useViewerOverlayStore((state) => state.mode);
  const signed = useDocumentMessagesStore((state) => (activeDocumentId ? state.signatures[activeDocumentId]?.state === "checked" : false));
  const layered = useLayerViewStore((state) => (activeDocumentId ? hasLayers(state.lists[activeDocumentId]) : false));
  useLayerCheck(activeDocumentId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F11" && activeDocumentId && !isTypingTarget(event.target)) {
        event.preventDefault();
        if (useUiStore.getState().immersive) void exitImmersive();
        else void setImmersiveFullscreen(true);
        return;
      }
      if (event.key === "F5" && activeDocumentId && !isTypingTarget(event.target)) {
        event.preventDefault();
        if (!useUiStore.getState().immersive) void setImmersiveFullscreen(true, event.shiftKey ? null : 1);
        return;
      }
      if (event.key === "Escape" && useUiStore.getState().immersive && !isTypingTarget(event.target)) {
        const presentation = usePresentationStore.getState();
        if (presentation.codeBlockOpen) {
          event.preventDefault();
          event.stopPropagation();
          presentation.closeCodeBlock();
          return;
        }
        if (presentation.overviewOpen) {
          event.preventDefault();
          event.stopPropagation();
          presentation.setOverviewOpen(false);
          return;
        }
        if (presentation.tool !== "pointer") {
          event.preventDefault();
          event.stopPropagation();
          presentation.setTool("pointer");
          return;
        }
        if (presentation.blackout !== "none") {
          event.preventDefault();
          event.stopPropagation();
          presentation.setBlackout("none");
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void exitImmersive();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "f") {
        event.preventDefault();
        if (!activeDocumentId) return;
        if (useViewerPanelsStore.getState().panels.search) useSearchBarState.getState().requestFocus();
        else setPanels((state) => ({ ...state, search: true }));
      } else if (key === "w" && activeDocumentId) {
        event.preventDefault();
        const overlay = useViewerOverlayStore.getState();
        overlay.requestLeave(() => closeDocuments([activeDocumentId]), overlay.objects.some(isPendingChange));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeDocumentId, closeDocuments, setPanels]);

  useEffect(() => {
    if (!activeDocumentId && useUiStore.getState().immersive) void exitImmersive();
  }, [activeDocumentId]);

  useEffect(() => {
    const openSearch = () => {
      if (activeDocumentId) setPanels((state) => (state.search ? state : { ...state, search: true }));
    };
    if (useSearchRequestStore.getState().isPending("viewer")) openSearch();
    const unsubscribe = useSearchRequestStore.subscribe((state, previous) => {
      if (state.nonce !== previous.nonce) openSearch();
    });
    return unsubscribe;
  }, [activeDocumentId, setPanels]);

  if (!activeDocumentId) {
    return (
      <DocumentEmptyState
        icon={FileText}
        title={t("viewer.empty.title")}
        description={t("viewer.empty.description")}
        highlights={[
          { icon: Search, label: t("viewer.empty.highlights.search") },
          { icon: Highlighter, label: t("viewer.empty.highlights.annotate") },
          { icon: Maximize, label: t("viewer.empty.highlights.present") },
        ]}
        onOpen={() => void pickAndOpen()}
        onOpenPath={(path) => void openPath(path)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">{t("nav.viewer")}</h1>
      {immersive ? null : <DocumentTabs />}
      <DocumentContent documentId={activeDocumentId}>
        {({ isLoading, isError, isLoaded }) => (
          <>
            {isLoading ? (
              <div className="p-6">
                <SkeletonCard lines={8} />
              </div>
            ) : null}
            {isError && !awaitingPassword ? (
              <ErrorState
                title={t("home.error.title")}
                message={t("errors.INVALID_PDF")}
                onRetry={() => {
                  const path = document?.path;
                  closeDocument(activeDocumentId);
                  if (path) void openPath(path);
                }}
              />
            ) : null}
            {isLoaded ? <ViewerDefaults documentId={activeDocumentId} /> : null}
            {isLoaded ? <ViewerShortcuts documentId={activeDocumentId} /> : null}
            {isLoaded ? <PendingJump documentId={activeDocumentId} /> : null}
            {isLoaded ? <ReadingPositionTracker key={activeDocumentId} documentId={activeDocumentId} /> : null}
            {isLoaded ? <PrintDialog documentId={activeDocumentId} /> : null}
            {isLoaded && immersive ? <ImmersiveView documentId={activeDocumentId} onExit={exitImmersive} /> : null}
            {isLoaded && !immersive ? (
              <>
                <ViewerToolbar documentId={activeDocumentId} panels={panels} onTogglePanel={togglePanel} />
                <DocumentMessageBar documentId={activeDocumentId} onOpenSignatures={() => setPanels((state) => ({ ...state, signatures: true }))} />
                <FallbackFontMessages documentId={activeDocumentId} />
                {panels.search ? (
                  <SearchBar documentId={activeDocumentId} onClose={() => setPanels((state) => ({ ...state, search: false }))} />
                ) : null}
                {panels.annotate ? (
                  <AnnotateBar documentId={activeDocumentId} onClose={() => setPanels((state) => ({ ...state, annotate: false }))} />
                ) : null}
                <OverlayBar documentId={activeDocumentId} />
                {panels.readAloud ? (
                  <ReadAloudBar key={activeDocumentId} documentId={activeDocumentId} onClose={() => setPanels((state) => ({ ...state, readAloud: false }))} />
                ) : null}
                <SpeechStatusBar />
                <div className="flex min-h-0 flex-1">
                  <NavigationRail panels={panels} onTogglePanel={togglePanel} showSignatures={signed} showLayers={layered} />
                  {panels.outline && !panels.reading ? <OutlinePanel key={activeDocumentId} documentId={activeDocumentId} /> : null}
                  {panels.thumbnails && !panels.reading ? <ThumbnailSidebar documentId={activeDocumentId} /> : null}
                  {panels.attachments ? <AttachmentsPanel key={activeDocumentId} documentId={activeDocumentId} /> : null}
                  {panels.signatures && signed && !panels.reading ? <SignaturesPanel documentId={activeDocumentId} /> : null}
                  {panels.layers && layered && !panels.reading ? <LayersPanel key={activeDocumentId} documentId={activeDocumentId} /> : null}
                  {panels.reading ? (
                    <ReadingView documentId={activeDocumentId} onExit={() => setPanels((state) => ({ ...state, reading: false }))} />
                  ) : (
                    <div ref={stageRef} className="relative min-w-0 flex-1">
                      <PageColorFilters />
                      <div className="h-full" data-page-colors={pageColors}>
                        <SplitStage documentId={activeDocumentId} pageColors={pageColors} />
                      </div>
                      <AutoScroller documentId={activeDocumentId} hostRef={stageRef} />
                      <SnapshotTaker documentId={activeDocumentId} />
                      {panels.present ? <PresentationCanvas containerRef={stageRef} /> : null}
                      {panels.present ? (
                        <PresentationBar
                          onClose={() => {
                            usePresentationStore.getState().setTool("pointer");
                            setPanels((state) => ({ ...state, present: false }));
                          }}
                        />
                      ) : null}
                      <SelectionActions key={activeDocumentId} documentId={activeDocumentId} containerRef={stageRef} />
                      <AreaTextPopover documentId={activeDocumentId} onMakeSearchable={(pageIndex) => requestSearchable({ pageIndex })} />
                      <MakeSearchableDialog documentId={activeDocumentId} />
                    </div>
                  )}
                  {overlayMode && EDITOR_MODES.includes(overlayMode) ? <EditPanel documentId={activeDocumentId} /> : null}
                  {panels.comments ? <CommentsPanel key={activeDocumentId} documentId={activeDocumentId} /> : null}
                  {panels.translate ? <TranslatePanel /> : null}
                  {panels.inspector && document ? <Inspector document={document} /> : null}
                  <ToolsRail panels={panels} onTogglePanel={togglePanel} pageColorsOn={pageColors !== "normal"} onTogglePageColors={togglePageColors} />
                </div>
              </>
            ) : null}
          </>
        )}
      </DocumentContent>
    </div>
  );
}

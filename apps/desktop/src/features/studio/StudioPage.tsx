import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useUiStore } from "@/shared/store/uiStore";
import { Canvas } from "./design/Canvas";
import { DesignLauncher } from "./design/DesignLauncher";
import { MissingFontsBar } from "./design/MissingFontsBar";
import { pickDesignFile } from "./design/projectFile";
import type { StudioRouteState } from "./design/recentDesigns";
import { useDesignSave } from "./design/useDesignSave";
import { useOpenDesign } from "./design/useOpenDesign";
import { ElementsPanel } from "./design/ElementsPanel";
import type { FindMode } from "./design/FindReplacePanel";
import { PagesStrip } from "./design/PagesStrip";
import { DetailsPanel } from "./design/PropertiesPanel";
import { ContextBar } from "./design/ContextBar";
import { StudioToolbar } from "./design/StudioToolbar";
import { useStudioStore } from "./design/studioStore";
import { useStudioShortcuts } from "./design/useStudioShortcuts";
import { useCvStore } from "./cv/cvStore";
import { launchStudioStart, studioStartOf, withoutStudioStart } from "./startLink";
import { useDocumentStore } from "./document/documentStore";
import { useMergeStore } from "./merge/mergeStore";
import { GraphicEditorHost } from "./graphics/GraphicEditorHost";
import { startGraphicSync } from "./graphics/graphicSync";
import { StudioStart } from "./start/StudioStart";
import { useShortcutSheetStore } from "@/features/about/shortcutSheetStore";

const DocumentEditor = lazy(() => import("./document/DocumentEditor"));
const CvStudio = lazy(() => import("./cv/CvStudio"));
const ExportDialog = lazy(() => import("./design/ExportDialog").then((module) => ({ default: module.ExportDialog })));
const StudioPrintDialog = lazy(() => import("./design/StudioPrintDialog").then((module) => ({ default: module.StudioPrintDialog })));
const StudioShortcutsDialog = lazy(() => import("./design/StudioShortcutsDialog").then((module) => ({ default: module.StudioShortcutsDialog })));
const FindReplacePanel = lazy(() => import("./design/FindReplacePanel").then((module) => ({ default: module.FindReplacePanel })));

function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return open || opened;
}

function StudioEditor({ language }: { language: string }) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [helping, setHelping] = useState(false);
  const [finding, setFinding] = useState<FindMode | null>(null);
  const exportLoaded = useOpenedOnce(exporting);
  const printLoaded = useOpenedOnce(printing);
  const helpLoaded = useOpenedOnce(helping);
  const close = useStudioStore((state) => state.close);
  useEffect(() => startGraphicSync(), []);
  const { save } = useDesignSave();
  const { openDesign } = useOpenDesign();
  const browse = async () => {
    const path = await pickDesignFile(t("studio.project.filter"));
    if (path) await openDesign(path);
  };
  useStudioShortcuts(
    () => setExporting(true),
    (saveAs) => void save(saveAs),
    {
      onOpen: () => void browse(),
      onHelp: () => setHelping(true),
      onPrint: () => setPrinting(true),
      onFind: (replace) => setFinding((current) => ({ replace, nonce: (current?.nonce ?? 0) + 1 })),
    },
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="studio-editor">
      <StudioToolbar onExport={() => setExporting(true)} onPrint={() => setPrinting(true)} onLeave={close} onHelp={() => setHelping(true)} />
      <ContextBar />
      <div className="flex min-h-0 flex-1">
        <ElementsPanel />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <MissingFontsBar />
          <div className="relative flex min-h-0 flex-1 flex-col">
            <Canvas language={language} />
            {finding ? (
              <Suspense fallback={null}>
                <FindReplacePanel mode={finding} language={language} onClose={() => setFinding(null)} />
              </Suspense>
            ) : null}
          </div>
          <PagesStrip language={language} />
        </div>
        <DetailsPanel />
      </div>
      <Suspense fallback={null}>
        {exportLoaded ? <ExportDialog open={exporting} onClose={() => setExporting(false)} language={language} /> : null}
        {printLoaded ? <StudioPrintDialog open={printing} onClose={() => setPrinting(false)} language={language} /> : null}
        {helpLoaded ? <StudioShortcutsDialog open={helping} onClose={() => setHelping(false)} /> : null}
      </Suspense>
      <GraphicEditorHost />
    </div>
  );
}

export function StudioPage() {
  const { t } = useTranslation();
  const editing = useStudioStore((state) => state.design !== null);
  const hasDocument = useDocumentStore((state) => state.document !== null);
  const open = useStudioStore((state) => state.open);
  const locale = useUiStore((state) => state.locale);
  const cvActive = useCvStore((state) => state.active);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { openDesign } = useOpenDesign();
  const handledLocation = useRef<string | null>(null);
  useEffect(() => {
    const designPath = (location.state as Partial<StudioRouteState> | null)?.designPath;
    if (typeof designPath !== "string" || handledLocation.current === location.key) return;
    handledLocation.current = location.key;
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    useCvStore.getState().close();
    void openDesign(designPath);
  }, [location, navigate, openDesign]);
  useEffect(() => {
    if (!editing) useMergeStore.getState().clear();
  }, [editing]);
  useEffect(() => {
    useShortcutSheetStore.getState().setStudioScreen(cvActive ? null : editing ? "design" : hasDocument ? "document" : null);
  }, [cvActive, editing, hasDocument]);
  useEffect(() => () => useShortcutSheetStore.getState().setStudioScreen(null), []);
  useEffect(() => {
    const start = studioStartOf(params);
    if (!start) return;
    launchStudioStart(start, t, locale);
    setParams((current) => withoutStudioStart(current), { replace: true });
  }, [params, setParams, locale, t]);
  return (
    <>
      {cvActive ? (
        <Suspense fallback={<div className="h-full animate-pulse bg-muted/40" aria-busy />}>
          <CvStudio />
        </Suspense>
      ) : editing ? (
        <StudioEditor language={locale} />
      ) : hasDocument ? (
        <Suspense fallback={<div className="h-full animate-pulse bg-muted/40" aria-busy />}>
          <DocumentEditor language={locale} />
        </Suspense>
      ) : (
        <StudioStart onOpen={open} />
      )}
      <DesignLauncher />
    </>
  );
}

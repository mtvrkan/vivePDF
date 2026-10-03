import { Suspense, lazy, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { listen } from "@tauri-apps/api/event";
import { AppShell } from "@/components/layout/AppShell";
import { RouteErrorBoundary } from "@/components/shared/ErrorBoundary";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Toaster } from "@/components/shared/Toaster";
import { TooltipLayer } from "@/components/shared/Tooltip";
import { ReportDialog } from "@/features/report/ReportDialog";
import { HomePage } from "@/features/home/HomePage";
import { FileOpenListener } from "@/features/viewer/FileOpenListener";
import { OrganizerSourceCleanup } from "@/features/pages/OrganizerSourceCleanup";
import { PasswordDialog } from "@/features/viewer/PasswordDialog";
import { exitImmersive, shouldExitOnKey } from "@/features/viewer/immersive";
import { PdfProvider } from "@/features/viewer/pdf/PdfProvider";
import { CloseGuard } from "@/shared/session/CloseGuard";
import { UnsavedCloseDialog } from "@/features/viewer/UnsavedCloseDialog";
import { SessionManager } from "@/shared/session/SessionManager";
import { followOtherWindows } from "@/shared/session/crossWindowSync";
import { shareOpenDocuments } from "@/shared/session/documentClaims";
import { releaseClosedDocuments } from "@/shared/session/engineRelease";
import { releaseClosedViewSources } from "@/shared/session/viewSources";
import { listenForMissingFonts } from "@/shared/session/fallbackFonts";
import { isMainWindow } from "@/shared/lib/windowRole";
import { TaskbarProgress } from "@/shared/session/TaskbarProgress";
import * as logger from "@/shared/lib/logger";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { fileAssociationStale, setFileAssociation, setShellIntegration, shellIntegrationStale } from "@/shared/rpc/files";
import { shellMenuEntries } from "@/shared/lib/shellMenu";
import { useEngineStore } from "@/shared/store/engineStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useUpdateStore } from "@/shared/store/updateStore";

const ViewerPage = lazy(() => import("@/features/viewer/ViewerPage").then((m) => ({ default: m.ViewerPage })));
const AboutPage = lazy(() => import("@/features/about/AboutPage").then((m) => ({ default: m.AboutPage })));
const PagesPage = lazy(() => import("@/features/pages/PagesPage").then((m) => ({ default: m.PagesPage })));
const SearchPage = lazy(() => import("@/features/search/SearchPage").then((m) => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const AccessPage = lazy(() => import("@/features/tools/access/AccessPage").then((m) => ({ default: m.AccessPage })));
const BatchPage = lazy(() => import("@/features/tools/batch/BatchPage").then((m) => ({ default: m.BatchPage })));
const CodesPage = lazy(() => import("@/features/tools/codes/CodesPage").then((m) => ({ default: m.CodesPage })));
const OmrPage = lazy(() => import("@/features/tools/omr/OmrPage").then((m) => ({ default: m.OmrPage })));
const ComparePage = lazy(() => import("@/features/tools/compare/ComparePage").then((m) => ({ default: m.ComparePage })));
const CompressPage = lazy(() => import("@/features/tools/compress/CompressPage").then((m) => ({ default: m.CompressPage })));
const FormsPage = lazy(() => import("@/features/tools/forms/FormsPage").then((m) => ({ default: m.FormsPage })));
const SignPage = lazy(() => import("@/features/tools/sign/SignPage").then((m) => ({ default: m.SignPage })));
const ConvertPage = lazy(() => import("@/features/tools/convert/ConvertPage").then((m) => ({ default: m.ConvertPage })));
const EditPage = lazy(() => import("@/features/tools/edit/EditPage").then((m) => ({ default: m.EditPage })));
const MergePage = lazy(() => import("@/features/tools/merge/MergePage").then((m) => ({ default: m.MergePage })));
const OcrPage = lazy(() => import("@/features/tools/ocr/OcrPage").then((m) => ({ default: m.OcrPage })));
const PreflightPage = lazy(() => import("@/features/tools/preflight/PreflightPage").then((m) => ({ default: m.PreflightPage })));
const PdfaPage = lazy(() => import("@/features/tools/pdfa/PdfaPage").then((m) => ({ default: m.PdfaPage })));
const RenamePage = lazy(() => import("@/features/tools/rename/RenamePage").then((m) => ({ default: m.RenamePage })));
const ScanPage = lazy(() => import("@/features/tools/scan/ScanPage").then((m) => ({ default: m.ScanPage })));
const SecurityPage = lazy(() => import("@/features/tools/security/SecurityPage").then((m) => ({ default: m.SecurityPage })));
const SplitPage = lazy(() => import("@/features/tools/split/SplitPage").then((m) => ({ default: m.SplitPage })));
const PageToolsPage = lazy(() => import("@/features/tools/pageTools/PageToolsPage").then((m) => ({ default: m.PageToolsPage })));
const WatchPage = lazy(() => import("@/features/tools/watch/WatchPage").then((m) => ({ default: m.WatchPage })));
const CreatePage = lazy(() => import("@/features/tools/create/CreatePage").then((m) => ({ default: m.CreatePage })));

function RouteFallback() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <SkeletonCard lines={5} />
    </div>
  );
}

export default function App() {
  const checkEngine = useEngineStore((state) => state.check);
  const { t } = useTranslation();

  useEffect(() => {
    void checkEngine();
  }, [checkEngine]);

  useEffect(() => followOtherWindows(), []);

  useEffect(() => shareOpenDocuments(), []);

  useEffect(() => releaseClosedDocuments(), []);

  useEffect(() => releaseClosedViewSources(), []);

  useEffect(() => listenForMissingFonts(), []);

  useEffect(() => {
    if (!isMainWindow()) return;
    void shellIntegrationStale().then((stale) => {
      if (stale) void setShellIntegration(true, t("app.name"), shellMenuEntries(t)).catch(() => undefined);
    });
    void fileAssociationStale().then((stale) => {
      if (stale) void setFileAssociation(true, t("app.name"), t("settings.system.associationType")).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV || !isMainWindow() || !useUpdateStore.getState().autoCheck) return;
    const timer = window.setTimeout(() => void useUpdateStore.getState().check(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      logger.error("window", event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      logger.error("window", String(event.reason));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const unlisten = listen("sidecar-died", () => {
      logger.error("sidecar", "process exited unexpectedly");
      useEngineStore.setState({ status: "error", error: { code: "SIDECAR_DIED", message: "SIDECAR_DIED" } });
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useUiStore.getState();
      if (shouldExitOnKey(event, { immersive: state.immersive, mounted: state.immersiveMounted })) {
        event.preventDefault();
        void exitImmersive();
      }
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && useUiStore.getState().immersive) void exitImmersive();
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  return (
    <MemoryRouter>
      <PdfProvider>
        <FileOpenListener />
        <OrganizerSourceCleanup />
        {isMainWindow() ? <SessionManager /> : null}
        <CloseGuard />
        <UnsavedCloseDialog />
        <TaskbarProgress />
        <AppShell>
          <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/viewer" element={<ViewerPage />} />
            <Route path="/pages" element={<PagesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/tools/compress" element={<CompressPage />} />
            <Route path="/tools/merge" element={<MergePage />} />
            <Route path="/tools/split" element={<SplitPage />} />
            <Route path="/tools/pages" element={<PageToolsPage />} />
            <Route path="/tools/security" element={<SecurityPage />} />
            <Route path="/tools/convert" element={<ConvertPage />} />
            <Route path="/tools/ocr" element={<OcrPage />} />
            <Route path="/tools/scan" element={<ScanPage />} />
            <Route path="/tools/rename" element={<RenamePage />} />
            <Route path="/tools/codes" element={<CodesPage />} />
            <Route path="/tools/omr" element={<OmrPage />} />
            <Route path="/tools/access" element={<AccessPage />} />
            <Route path="/tools/preflight" element={<PreflightPage />} />
            <Route path="/tools/pdfa" element={<PdfaPage />} />
            <Route path="/tools/edit" element={<EditPage />} />
            <Route path="/tools/sign" element={<SignPage />} />
            <Route path="/tools/forms" element={<FormsPage />} />
            <Route path="/tools/compare" element={<ComparePage />} />
            <Route path="/tools/batch" element={<BatchPage />} />
            <Route path="/tools/watch" element={<WatchPage />} />
            <Route path="/tools/create" element={<CreatePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage />} />
          </Routes>
          </Suspense>
          </RouteErrorBoundary>
        </AppShell>
        <PasswordDialog />
      </PdfProvider>
      <Toaster />
      <TooltipLayer />
      <ReportDialog />
    </MemoryRouter>
  );
}

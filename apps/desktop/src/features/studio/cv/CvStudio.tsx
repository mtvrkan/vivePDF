import { memo, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, Eraser, FileJson, FileText, FileUp, FolderOpen, PenLine, Redo2, RefreshCw, Save, Sparkles, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { translatorFor } from "@/app/i18n";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { MenuButton } from "@/components/shared/MenuButton";
import { describeError } from "@/shared/lib/errorMessage";
import { cn } from "@/shared/lib/cn";
import { shortcutLetter } from "@/shared/lib/shortcutKeys";
import { toRpcError } from "@/shared/rpc/client";
import { studioSaveImage } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import type { StudioDesign } from "@/types/studio";
import { useImagePreview } from "../design/assets";
import { PageView } from "../design/ElementView";
import { useStudioStore } from "../design/studioStore";
import { useDesignSave } from "../design/useDesignSave";
import { CvDesignPanel } from "./CvDesignPanel";
import { CvExportDialog } from "./CvExportDialog";
import { CvForm } from "./CvForm";
import { CvImportDialog } from "./CvImportDialog";
import { CvSteps } from "./CvSteps";
import { cvSteps, type CvStepId } from "./stepOrder";
import { pickCvPdf, saveCvFile, withStoredPhoto } from "./cvFiles";
import type { CvOverflow } from "./cvLayout";
import { cvFromJson, emptyProfile, isStoredPhoto, profileHasContent, sampleProfile, type CvProfile, type CvSectionKey, type CvState } from "./cvModel";
import { keepUnchanged, renderCv } from "./cvRender";
import { flushCvSave, useCvStore } from "./cvStore";

import { commandKey } from "@/shared/lib/platform";
const RENDER_DELAY_MS = 180;
const PREVIEW_PADDING = 48;
const MAX_PREVIEW_SCALE = 1.25;
const LONG_CV_PAGES = 2;

function usePreviewWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function redoKey(event: KeyboardEvent, letter: string | null): boolean {
  return letter === "y" || (letter === "z" && event.shiftKey);
}

const PreviewPages = memo(function PreviewPages({ design, scale, language }: { design: StudioDesign; scale: number; language: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-6 py-6">
      {design.pages.map((item, index) => (
        <div key={item.id} className="paper-surface relative overflow-hidden rounded-sm bg-white shadow-lg" style={{ width: `${item.width * scale}px`, height: `${item.height * scale}px` }} role="img" aria-label={t("studio.cv.pageLabel", { page: index + 1, total: design.pages.length })}>
          <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
            <PageView page={item} language={language} />
          </div>
        </div>
      ))}
    </div>
  );
});

export default function CvStudio() {
  const { t } = useTranslation();
  const profile = useCvStore((state) => state.profile);
  const theme = useCvStore((state) => state.theme);
  const canUndo = useCvStore((state) => state.past.length > 0);
  const canRedo = useCvStore((state) => state.future.length > 0);
  const saveFailed = useCvStore((state) => state.saveFailed);
  const close = useCvStore((state) => state.close);
  const pushToast = useToastStore((state) => state.push);
  const [step, setStep] = useState<CvStepId>("personal");
  const [designVisited, setDesignVisited] = useState(false);
  if (step === "design" && !designVisited) setDesignVisited(true);
  const [design, setDesign] = useState<StudioDesign | null>(null);
  const [overflow, setOverflow] = useState<CvOverflow>({ items: 0, sections: [] });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const openDesignName = useStudioStore((state) => state.design?.name ?? "");
  const designSave = useDesignSave();
  const jsonInput = useRef<HTMLInputElement>(null);
  const preview = usePreviewWidth();
  const untitled = t("studio.cv.untitled");
  const photoMissing = useImagePreview(profile.photo)?.status === "error";

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const translate = await translatorFor(theme.language);
          const next = await renderCv(photoMissing ? { ...profile, photo: null, photoCrop: null } : profile, theme, translate, profile.name.trim() || untitled);
          if (!live) return;
          setDesign((previous) => keepUnchanged(next.design, previous));
          setOverflow((previous) => (previous.items === next.overflow.items && previous.sections.join() === next.overflow.sections.join() ? previous : next.overflow));
          setFailed(false);
        } catch {
          if (live) setFailed(true);
        }
      })();
    }, RENDER_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [profile, theme, untitled, attempt, photoMissing]);

  useEffect(() => {
    const photo = profile.photo;
    if (!photo || isStoredPhoto(photo)) return;
    void studioSaveImage({ path: photo }).then(
      (saved) => useCvStore.getState().adoptPhoto(photo, saved.path),
      () => undefined,
    );
  }, [profile.photo]);

  useEffect(() => {
    window.addEventListener("pagehide", flushCvSave);
    const unlisten = getCurrentWindow().onCloseRequested(flushCvSave);
    return () => {
      window.removeEventListener("pagehide", flushCvSave);
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (saveFailed) pushToast("error", t("studio.cv.saveFailed"));
  }, [saveFailed, pushToast, t]);

  const empty = !profileHasContent(profile);
  const ready = design !== null && !failed && !empty;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!commandKey(event) || event.altKey || document.querySelector('[role="dialog"]')) return;
      const letter = shortcutLetter(event);
      const store = useCvStore.getState();
      if (letter === "e" && !event.shiftKey && readyRef.current) {
        event.preventDefault();
        event.stopPropagation();
        setExporting(true);
      } else if (letter === "z" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        store.undo();
      } else if (redoKey(event, letter)) {
        event.preventDefault();
        event.stopPropagation();
        store.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const restoring = (before: CvState) => ({ label: t("common.undo"), onClick: () => useCvStore.getState().replace(before) });

  const swap = (next: CvProfile, message: string) => {
    const store = useCvStore.getState();
    const before = store.snapshot();
    store.replace({ profile: next, theme: store.theme });
    pushToast("info", message, restoring(before));
  };

  const openInStudio = () => {
    setReplacing(false);
    if (!design) return;
    useStudioStore.getState().open(design);
    close();
  };

  const editInStudio = () => {
    if (!design) return;
    const studio = useStudioStore.getState();
    if (studio.design && studio.dirty) setReplacing(true);
    else openInStudio();
  };

  const importPdf = async () => {
    const path = await pickCvPdf(t("studio.cv.import.pickPdf"));
    if (path) setImporting(path);
  };

  const openJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text().catch(() => null);
    const opened = text === null ? null : cvFromJson(text, theme.language);
    if (!opened) {
      pushToast("error", t("studio.cv.file.unreadable"));
      return;
    }
    const state = await withStoredPhoto(opened);
    const before = useCvStore.getState().snapshot();
    useCvStore.getState().replace(state);
    pushToast("info", t("studio.cv.file.opened"), restoring(before));
  };

  const saveJson = async () => {
    try {
      const path = await saveCvFile(useCvStore.getState().snapshot(), profile.name.trim() || untitled, t("studio.cv.file.filter"));
      if (path) pushToast("success", t("studio.cv.file.saved"));
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
    }
  };

  const showSection = (section: CvSectionKey) => setStep(section);

  const page = design?.pages[0];
  const scale = page && preview.width > 0 ? Math.min(MAX_PREVIEW_SCALE, (preview.width - PREVIEW_PADDING) / page.width) : 0;
  const pages = design?.pages.length ?? 0;
  const steps = cvSteps(profile.order);
  const stepIndex = steps.indexOf(step);
  const previousStep = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextStep = stepIndex >= 0 && stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null;
  const stepLabel = (item: CvStepId) => (item === "design" ? t("studio.cv.tabs.design") : item === "personal" ? t("studio.cv.personal") : t(`studio.cv.sections.${item}`));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="cv-studio">
      <div className="glass-flat flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />} onClick={close}>
          {t("studio.title")}
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("studio.cv.title")}</h1>
        {design ? (
          <span data-testid="cv-page-count" title={pages > LONG_CV_PAGES ? t("studio.cv.pagesHint") : undefined} className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", pages > LONG_CV_PAGES ? "bg-warning/15 text-warning" : "text-muted-foreground")}>
            {t("studio.start.pages", { count: pages })}
          </span>
        ) : null}
        <IconButton icon={Undo2} label={t("studio.toolbar.undo")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => useCvStore.getState().undo()} />
        <IconButton icon={Redo2} label={t("studio.toolbar.redo")} shortcut="Ctrl+Y" disabled={!canRedo} onClick={() => useCvStore.getState().redo()} />
        <MenuButton
          icon={FileJson}
          label={t("studio.cv.file.menu")}
          items={[
            { type: "item", id: "pdf", label: t("studio.cv.import.fromPdf"), icon: FileUp, onSelect: () => void importPdf() },
            { type: "item", id: "open", label: t("studio.cv.file.open"), icon: FolderOpen, onSelect: () => jsonInput.current?.click() },
            { type: "separator", id: "split" },
            { type: "item", id: "save", label: t("studio.cv.file.save"), icon: Save, onSelect: () => void saveJson() },
          ]}
        />
        <input ref={jsonInput} type="file" accept=".json,application/json" className="hidden" aria-hidden tabIndex={-1} onChange={(event) => void openJson(event)} data-testid="cv-json-input" />
        <Button size="sm" variant="ghost" icon={<Sparkles className="size-4" aria-hidden />} onClick={() => swap(sampleProfile(t), t("studio.cv.sampleFilled"))}>
          {t("studio.cv.fillSample")}
        </Button>
        <Button size="sm" variant="ghost" icon={<Eraser className="size-4" aria-hidden />} onClick={() => swap(emptyProfile(), t("studio.cv.cleared"))}>
          {t("studio.cv.clear")}
        </Button>
        <Button size="sm" icon={<PenLine className="size-4" aria-hidden />} disabled={!ready} onClick={editInStudio}>
          {t("studio.cv.editInStudio")}
        </Button>
        <Button size="sm" variant="primary" icon={<Download className="size-4" aria-hidden />} disabled={!ready} onClick={() => setExporting(true)}>
          {t("studio.cv.export.open")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="glass-flat w-52 shrink-0 overflow-y-auto border-e border-border/60 p-2" aria-label={t("studio.cv.panel")}>
          <CvSteps step={step} onChange={setStep} />
        </nav>
        <div id="cv-step-panel" role="tabpanel" aria-labelledby={`cv-step-${step}`} className="flex w-96 shrink-0 flex-col border-e border-border/60">
          <div id="cv-panel-design" hidden={step !== "design"} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {designVisited ? <CvDesignPanel /> : null}
          </div>
          {step === "design" ? null : (
            <div key={step} id="cv-panel-content" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <CvForm only={step} />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-2">
            {previousStep ? (
              <Button size="sm" variant="ghost" icon={<ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />} onClick={() => setStep(previousStep)} data-testid="cv-step-previous">
                {stepLabel(previousStep)}
              </Button>
            ) : null}
            {nextStep ? (
              <Button size="sm" variant="primary" className="ms-auto" onClick={() => setStep(nextStep)} data-testid="cv-step-next">
                {t("studio.cv.steps.next", { name: stepLabel(nextStep) })}
                <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>
        <div ref={preview.ref} role="region" className="min-w-0 flex-1 overflow-auto bg-muted/40" aria-label={t("studio.cv.preview")} aria-busy={!design && !failed}>
          {failed && design ? (
            <div role="alert" className="sticky top-0 z-10 m-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-sm shadow-sm">
              <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
              <span className="min-w-0 flex-1">{t("studio.cv.previewStale")}</span>
              <Button size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => setAttempt((value) => value + 1)}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {overflow.items > 0 && design && !empty ? (
            <div role="status" data-testid="cv-overflow" className="sticky top-0 z-10 m-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-card px-3 py-2 text-sm shadow-sm">
              <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1">{t("studio.cv.overflow", { count: overflow.items })}</span>
              {overflow.sections.slice(0, 3).map((section) => (
                <Button key={section} size="sm" variant="ghost" onClick={() => showSection(section)}>
                  {t(`studio.cv.sections.${section}`)}
                </Button>
              ))}
            </div>
          ) : null}
          {empty ? (
            <EmptyState
              icon={FileText}
              title={t("studio.cv.emptyTitle")}
              description={t("studio.cv.emptyDescription")}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" icon={<Sparkles className="size-4" aria-hidden />} onClick={() => swap(sampleProfile(t), t("studio.cv.sampleFilled"))}>
                    {t("studio.cv.fillSample")}
                  </Button>
                  <Button icon={<FileUp className="size-4" aria-hidden />} onClick={() => void importPdf()}>
                    {t("studio.cv.import.fromPdf")}
                  </Button>
                </div>
              }
            />
          ) : failed && !design ? (
            <div className="p-8">
              <ErrorState title={t("studio.cv.previewFailed")} message={t("studio.cv.previewFailedHint")} onRetry={() => setAttempt((value) => value + 1)} />
            </div>
          ) : design && page && scale > 0 ? (
            <PreviewPages design={design} scale={scale} language={theme.language} />
          ) : (
            <div className="flex justify-center py-6">
              <div className="aspect-[1/1.414] w-2/3 max-w-xl animate-pulse rounded-sm bg-muted" />
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={replacing}
        onClose={() => setReplacing(false)}
        title={t("studio.project.unsavedTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplacing(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="ghost" onClick={openInStudio}>
              {t("studio.project.discard")}
            </Button>
            <Button variant="primary" loading={designSave.saving} onClick={() => void designSave.save(false).then((saved) => saved && openInStudio())}>
              {t("studio.project.save")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("studio.project.unsavedBody", { name: openDesignName || t("studio.untitled") })}</p>
      </Dialog>
      <CvExportDialog open={exporting} onClose={() => setExporting(false)} design={design} language={theme.language} />
      <CvImportDialog
        path={importing}
        onClose={() => setImporting(null)}
        onApply={(change) => {
          const before = useCvStore.getState().snapshot();
          useCvStore.getState().updateProfile(change);
          setImporting(null);
          pushToast("success", t("studio.cv.import.done"), restoring(before));
        }}
      />
    </div>
  );
}

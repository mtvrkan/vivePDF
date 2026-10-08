import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, ArrowLeft, Download, Eraser, FileJson, FileText, FileUp, FolderOpen, Palette, PenLine, Redo2, RefreshCw, Save, Sparkles, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translatorFor } from "@/app/i18n";
import { Button } from "@/components/shared/Button";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { MenuButton } from "@/components/shared/MenuButton";
import { describeError } from "@/shared/lib/errorMessage";
import { cn } from "@/shared/lib/cn";
import { shortcutLetter } from "@/shared/lib/shortcutKeys";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { StudioDesign } from "@/types/studio";
import { PageView } from "../design/ElementView";
import { useStudioStore } from "../design/studioStore";
import { CvDesignPanel } from "./CvDesignPanel";
import { CvExportDialog } from "./CvExportDialog";
import { CvForm } from "./CvForm";
import { CvImportDialog } from "./CvImportDialog";
import { pickCvPdf, saveCvFile } from "./cvFiles";
import type { CvOverflow } from "./cvLayout";
import { cvFromJson, emptyProfile, sampleProfile, type CvProfile, type CvSectionKey } from "./cvModel";
import { keepUnchanged, renderCv } from "./cvRender";
import { useCvStore } from "./cvStore";

const RENDER_DELAY_MS = 180;
const PREVIEW_PADDING = 48;
const MAX_PREVIEW_SCALE = 1.25;
const LONG_CV_PAGES = 2;

type Tab = "content" | "design";

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

export default function CvStudio() {
  const { t } = useTranslation();
  const profile = useCvStore((state) => state.profile);
  const theme = useCvStore((state) => state.theme);
  const canUndo = useCvStore((state) => state.past.length > 0);
  const canRedo = useCvStore((state) => state.future.length > 0);
  const saveFailed = useCvStore((state) => state.saveFailed);
  const close = useCvStore((state) => state.close);
  const pushToast = useToastStore((state) => state.push);
  const [tab, setTab] = useState<Tab>("content");
  const [design, setDesign] = useState<StudioDesign | null>(null);
  const [overflow, setOverflow] = useState<CvOverflow>({ items: 0, sections: [] });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const preview = usePreviewWidth();
  const untitled = t("studio.cv.untitled");

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const translate = await translatorFor(theme.language);
          const next = await renderCv(profile, theme, translate, profile.name.trim() || untitled);
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
  }, [profile, theme, untitled, attempt]);

  useEffect(() => {
    if (saveFailed) pushToast("error", t("studio.cv.saveFailed"));
  }, [saveFailed, pushToast, t]);

  const designRef = useRef(design);
  designRef.current = design;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || document.querySelector('[role="dialog"]')) return;
      const letter = shortcutLetter(event);
      const store = useCvStore.getState();
      if (letter === "e" && !event.shiftKey && designRef.current) {
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

  const swap = (next: CvProfile, message: string) => {
    const store = useCvStore.getState();
    store.replace({ profile: next, theme: store.theme });
    pushToast("info", message, { label: t("common.undo"), onClick: () => useCvStore.getState().undo() });
  };

  const editInStudio = () => {
    if (!design) return;
    useStudioStore.getState().open(design);
    close();
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
    const state = text === null ? null : cvFromJson(text, theme.language);
    if (!state) {
      pushToast("error", t("studio.cv.file.unreadable"));
      return;
    }
    useCvStore.getState().replace(state);
    pushToast("info", t("studio.cv.file.opened"), { label: t("common.undo"), onClick: () => useCvStore.getState().undo() });
  };

  const saveJson = async () => {
    try {
      const path = await saveCvFile(useCvStore.getState().snapshot(), profile.name.trim() || untitled, t("studio.cv.file.filter"));
      if (path) pushToast("success", t("studio.cv.file.saved"));
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
    }
  };

  const showSection = (section: CvSectionKey) => {
    setTab("content");
    window.setTimeout(() => document.querySelector(`[data-cv-section="${section}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  };

  const page = design?.pages[0];
  const scale = page && preview.width > 0 ? Math.min(MAX_PREVIEW_SCALE, (preview.width - PREVIEW_PADDING) / page.width) : 0;
  const pages = design?.pages.length ?? 0;
  const tabs: Array<{ id: Tab; icon: typeof FileText; label: string }> = [
    { id: "content", icon: FileText, label: t("studio.cv.tabs.content") },
    { id: "design", icon: Palette, label: t("studio.cv.tabs.design") },
  ];

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
        <Button size="sm" icon={<PenLine className="size-4" aria-hidden />} disabled={!design} onClick={editInStudio}>
          {t("studio.cv.editInStudio")}
        </Button>
        <Button size="sm" variant="primary" icon={<Download className="size-4" aria-hidden />} disabled={!design} onClick={() => setExporting(true)}>
          {t("studio.cv.export.open")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-96 shrink-0 flex-col border-e border-border/60" aria-label={t("studio.cv.panel")}>
          <div className="flex gap-1 p-2" role="tablist" aria-label={t("studio.cv.panel")}>
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => setTab(item.id)}
                  className={cn("flex h-8 flex-1 items-center justify-center gap-2 rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === item.id ? "menubar-active font-medium" : "text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground")}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6" role="tabpanel">
            {tab === "content" ? <CvForm /> : <CvDesignPanel />}
          </div>
        </aside>
        <div ref={preview.ref} className="min-w-0 flex-1 overflow-auto bg-muted/40" aria-label={t("studio.cv.preview")} aria-busy={!design && !failed}>
          {failed && design ? (
            <div role="alert" className="sticky top-0 z-10 m-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-sm shadow-sm">
              <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
              <span className="min-w-0 flex-1">{t("studio.cv.previewStale")}</span>
              <Button size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => setAttempt((value) => value + 1)}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {overflow.items > 0 && design ? (
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
          {failed && !design ? (
            <div className="p-8">
              <ErrorState title={t("studio.cv.previewFailed")} message={t("studio.cv.previewFailedHint")} onRetry={() => setAttempt((value) => value + 1)} />
            </div>
          ) : design && page && scale > 0 ? (
            <div className="flex flex-col items-center gap-6 py-6">
              {design.pages.map((item, index) => (
                <div key={item.id} className="paper-surface relative overflow-hidden rounded-sm bg-white shadow-lg" style={{ width: `${item.width * scale}px`, height: `${item.height * scale}px` }} aria-label={t("studio.cv.pageLabel", { page: index + 1, total: design.pages.length })}>
                  <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
                    <PageView page={item} language={theme.language} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex justify-center py-6">
              <div className="aspect-[1/1.414] w-2/3 max-w-xl animate-pulse rounded-sm bg-muted" />
            </div>
          )}
        </div>
      </div>
      <CvExportDialog open={exporting} onClose={() => setExporting(false)} design={design} language={theme.language} />
      <CvImportDialog
        path={importing}
        onClose={() => setImporting(null)}
        onApply={(change) => {
          useCvStore.getState().updateProfile(change);
          setImporting(null);
          pushToast("success", t("studio.cv.import.done"), { label: t("common.undo"), onClick: () => useCvStore.getState().undo() });
        }}
      />
    </div>
  );
}

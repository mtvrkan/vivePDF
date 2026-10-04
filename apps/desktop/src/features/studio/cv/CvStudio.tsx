import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Eraser, FileText, Palette, PenLine, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translatorFor } from "@/app/i18n";
import { Button } from "@/components/shared/Button";
import { ErrorState } from "@/components/shared/ErrorState";
import { cn } from "@/shared/lib/cn";
import { shortcutLetter } from "@/shared/lib/shortcutKeys";
import { useToastStore } from "@/shared/store/toastStore";
import type { StudioDesign } from "@/types/studio";
import { PageView } from "../design/ElementView";
import { useStudioStore } from "../design/studioStore";
import { CvDesignPanel } from "./CvDesignPanel";
import { CvExportDialog } from "./CvExportDialog";
import { CvForm } from "./CvForm";
import { emptyProfile, sampleProfile } from "./cvModel";
import { renderCv } from "./cvRender";
import { useCvStore } from "./cvStore";

const RENDER_DELAY_MS = 180;
const PREVIEW_PADDING = 48;
const MAX_PREVIEW_SCALE = 1.25;

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

export default function CvStudio() {
  const { t } = useTranslation();
  const profile = useCvStore((state) => state.profile);
  const theme = useCvStore((state) => state.theme);
  const close = useCvStore((state) => state.close);
  const replace = useCvStore((state) => state.replace);
  const pushToast = useToastStore((state) => state.push);
  const [tab, setTab] = useState<Tab>("content");
  const [design, setDesign] = useState<StudioDesign | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
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
          setDesign(next);
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

  const designRef = useRef(design);
  designRef.current = design;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || document.querySelector('[role="dialog"]')) return;
      if (shortcutLetter(event) !== "e" || !designRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setExporting(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const swap = (next: typeof profile, message: string) => {
    const previous = useCvStore.getState().snapshot();
    replace({ profile: next, theme });
    pushToast("info", message, { label: t("common.undo"), onClick: () => replace(previous) });
  };

  const editInStudio = () => {
    if (!design) return;
    useStudioStore.getState().open(design);
    close();
  };

  const page = design?.pages[0];
  const scale = page && preview.width > 0 ? Math.min(MAX_PREVIEW_SCALE, (preview.width - PREVIEW_PADDING) / page.width) : 0;
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
        {design ? <span className="text-xs tabular-nums text-muted-foreground">{t("studio.start.pages", { count: design.pages.length })}</span> : null}
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
    </div>
  );
}

import { lazy, Suspense, useEffect, useState } from "react";
import { FolderOpen, IdCard, Palette, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { PageHeader } from "@/components/shared/PageHeader";
import { useUiStore } from "@/shared/store/uiStore";
import type { StudioDesign } from "@/types/studio";
import { STUDIO_PAGE_SIZES, createDesign, type StudioPageSize } from "./model/design";
import { Canvas } from "./design/Canvas";
import { NumberField } from "./design/controls";
import { DesignLauncher } from "./design/DesignLauncher";
import { MissingFontsBar } from "./design/MissingFontsBar";
import { pickDesignFile } from "./design/projectFile";
import { useRecentDesignsStore, type RecentDesign } from "./design/recentDesigns";
import { useDesignSave } from "./design/useDesignSave";
import { useOpenDesign } from "./design/useOpenDesign";
import { fromMm, toMm } from "./design/units";
import { ElementsPanel } from "./design/ElementsPanel";
import { PageView } from "./design/ElementView";
import { ExportDialog } from "./design/ExportDialog";
import { PagesStrip } from "./design/PagesStrip";
import { PropertiesPanel } from "./design/PropertiesPanel";
import { StudioShortcutsDialog } from "./design/StudioShortcutsDialog";
import { StudioToolbar } from "./design/StudioToolbar";
import { readDraft, useStudioStore } from "./design/studioStore";
import { useStudioShortcuts } from "./design/useStudioShortcuts";
import { useCvStore } from "./cv/cvStore";
import { DocumentStart } from "./document/DocumentStart";
import { useDocumentStore } from "./document/documentStore";
import { useMergeStore } from "./merge/mergeStore";
import { buildTemplate } from "./templates/catalog";
import { TemplateGallery } from "./templates/TemplateGallery";

const DocumentEditor = lazy(() => import("./document/DocumentEditor"));
const CvStudio = lazy(() => import("./cv/CvStudio"));

const START_SIZES: StudioPageSize[] = ["a4", "a4Landscape", "a5", "letter", "square", "story", "presentation", "businessCard", "poster"];
const PREVIEW_BOX = 96;

function SizeCard({ size, onPick }: { size: StudioPageSize; onPick: () => void }) {
  const { t } = useTranslation();
  const { width, height } = STUDIO_PAGE_SIZES[size];
  const scale = PREVIEW_BOX / Math.max(width, height);
  return (
    <button type="button" onClick={onPick} data-size={size} className="card glass-tinted flex flex-col items-center gap-3 rounded-xl p-4 text-center hover:ring-2 hover:ring-primary/40">
      <span className="flex size-24 items-center justify-center" aria-hidden>
        <span className="paper-surface rounded-sm border border-border bg-white shadow-sm" style={{ width: `${width * scale}px`, height: `${height * scale}px` }} />
      </span>
      <span className="text-sm font-medium">{t(`studio.sizes.${size}`)}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {toMm(width)} × {toMm(height)} mm
      </span>
    </button>
  );
}

function RecentCard({ item, locale, busy, onOpen }: { item: RecentDesign; locale: string; busy: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const remove = useRecentDesignsStore((state) => state.remove);
  const scale = PREVIEW_BOX / Math.max(item.width, item.height);
  return (
    <li className="card glass-tinted group relative flex flex-col rounded-xl">
      <button type="button" onClick={onOpen} disabled={busy} title={item.path} data-recent-design={item.name} className="flex flex-col items-center gap-3 rounded-xl p-4 text-center hover:ring-2 hover:ring-primary/40 disabled:opacity-60">
        <span className="flex size-24 items-center justify-center" aria-hidden>
          {item.thumbnail ? (
            <img src={item.thumbnail} alt="" width={Math.round(item.width * scale)} height={Math.round(item.height * scale)} className="rounded-sm border border-border shadow-sm" />
          ) : (
            <span className="paper-surface rounded-sm border border-border bg-white shadow-sm" style={{ width: `${item.width * scale}px`, height: `${item.height * scale}px` }} />
          )}
        </span>
        <span className="w-full truncate text-sm font-medium">{item.name}</span>
        <span className="text-xs text-muted-foreground">{new Date(item.savedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</span>
      </button>
      <span className="absolute right-1 top-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton icon={X} label={t("studio.project.forget", { name: item.name })} onClick={() => remove(item.path)} />
      </span>
    </li>
  );
}

function StudioStart({ onOpen }: { onOpen: (design: StudioDesign, filePath?: string | null) => void }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const recent = useRecentDesignsStore((state) => state.items);
  const { opening, openDesign } = useOpenDesign();
  const browse = async () => {
    const path = await pickDesignFile(t("studio.project.filter"));
    if (path) await openDesign(path);
  };
  const [draft] = useState(readDraft);
  const [custom, setCustom] = useState({ width: 210, height: 297 });
  const create = (width: number, height: number) => onOpen(createDesign("", width, height));
  const firstPage = draft?.design.pages[0];
  const previewScale = firstPage ? PREVIEW_BOX / Math.max(firstPage.width, firstPage.height) : 1;

  return (
    <div className="min-h-full">
      <PageHeader
        title={t("studio.title")}
        description={t("studio.description")}
        icon={Palette}
        tone="toPdf"
        actions={
          <Button icon={<FolderOpen className="size-4" aria-hidden />} loading={opening !== null} onClick={() => void browse()}>
            {t("studio.project.open")}
          </Button>
        }
      />
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 md:px-6">
        {draft && firstPage ? (
          <section className="card glass-tinted flex flex-wrap items-center gap-4 rounded-xl p-4" aria-label={t("studio.start.continue")}>
            <span className="relative block shrink-0 overflow-hidden rounded-md border border-border" style={{ width: `${firstPage.width * previewScale}px`, height: `${firstPage.height * previewScale}px` }} aria-hidden>
              <span className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${previewScale})` }}>
                <PageView page={firstPage} language={locale} />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("studio.start.continue")}</p>
              <p className="truncate text-sm text-muted-foreground">
                {draft.design.name || t("studio.untitled")} · {t("studio.start.pages", { count: draft.design.pages.length })}
              </p>
            </div>
            <Button variant="primary" icon={<Play className="size-4" aria-hidden />} onClick={() => onOpen(draft.design, draft.filePath)}>
              {t("studio.start.resume")}
            </Button>
          </section>
        ) : null}
        <section className="card glass-tinted flex flex-wrap items-center gap-4 rounded-xl p-4" aria-labelledby="studio-cv">
          <span className="tone-tile flex size-12 shrink-0 items-center justify-center rounded-xl" data-tone="toPdf" aria-hidden>
            <IdCard className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="studio-cv" className="text-sm font-semibold">
              {t("studio.cv.startTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("studio.cv.startDescription")}</p>
          </div>
          <Button variant="primary" icon={<IdCard className="size-4" aria-hidden />} onClick={() => useCvStore.getState().open(locale)} data-testid="studio-cv-start">
            {t("studio.cv.start")}
          </Button>
        </section>
        {recent.length ? (
          <section className="space-y-3" aria-labelledby="studio-recent">
            <h2 id="studio-recent" className="text-base font-semibold">
              {t("studio.project.recent")}
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {recent.map((item) => (
                <RecentCard key={item.path} item={item} locale={locale} busy={opening !== null} onOpen={() => void openDesign(item.path)} />
              ))}
            </ul>
          </section>
        ) : null}
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t("studio.start.blank")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {START_SIZES.map((size) => (
              <SizeCard key={size} size={size} onPick={() => create(STUDIO_PAGE_SIZES[size].width, STUDIO_PAGE_SIZES[size].height)} />
            ))}
          </div>
        </section>
        <section className="card glass-tinted flex flex-wrap items-end gap-3 rounded-xl p-4">
          <h2 className="w-full text-sm font-semibold">{t("studio.start.custom")}</h2>
          <div className="w-32">
            <NumberField label={t("studio.page.width")} suffix="mm" value={custom.width} min={6.4} max={5080} onChange={(width) => setCustom((current) => ({ ...current, width }))} />
          </div>
          <div className="w-32">
            <NumberField label={t("studio.page.height")} suffix="mm" value={custom.height} min={6.4} max={5080} onChange={(height) => setCustom((current) => ({ ...current, height }))} />
          </div>
          <Button onClick={() => create(fromMm(custom.width), fromMm(custom.height))}>{t("studio.start.create")}</Button>
        </section>
        <DocumentStart language={locale} />
        <section className="space-y-3" aria-labelledby="studio-templates">
          <h2 id="studio-templates" className="text-base font-semibold">
            {t("studio.templates.title")}
          </h2>
          <TemplateGallery language={locale} box={140} onPick={(template) => onOpen(buildTemplate(template, t, locale))} />
        </section>
      </div>
    </div>
  );
}

function StudioEditor({ language }: { language: string }) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [helping, setHelping] = useState(false);
  const close = useStudioStore((state) => state.close);
  const { save } = useDesignSave();
  const { openDesign } = useOpenDesign();
  const browse = async () => {
    const path = await pickDesignFile(t("studio.project.filter"));
    if (path) await openDesign(path);
  };
  useStudioShortcuts(
    () => setExporting(true),
    (saveAs) => void save(saveAs),
    { onOpen: () => void browse(), onHelp: () => setHelping(true) },
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="studio-editor">
      <StudioToolbar onExport={() => setExporting(true)} onLeave={close} onHelp={() => setHelping(true)} />
      <div className="flex min-h-0 flex-1">
        <ElementsPanel />
        <div className="flex min-w-0 flex-1 flex-col">
          <MissingFontsBar />
          <Canvas language={language} />
          <PagesStrip language={language} />
        </div>
        <PropertiesPanel />
      </div>
      <ExportDialog open={exporting} onClose={() => setExporting(false)} language={language} />
      <StudioShortcutsDialog open={helping} onClose={() => setHelping(false)} />
    </div>
  );
}

export function StudioPage() {
  const design = useStudioStore((state) => state.design);
  const document = useDocumentStore((state) => state.document);
  const open = useStudioStore((state) => state.open);
  const locale = useUiStore((state) => state.locale);
  const cvActive = useCvStore((state) => state.active);
  const [params, setParams] = useSearchParams();
  const editing = design !== null;
  useEffect(() => {
    if (!editing) useMergeStore.getState().clear();
  }, [editing]);
  useEffect(() => {
    if (params.get("cv") !== "1") return;
    useCvStore.getState().open(locale);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("cv");
      return next;
    }, { replace: true });
  }, [params, setParams, locale]);
  return (
    <>
      {cvActive ? (
        <Suspense fallback={<div className="h-full animate-pulse bg-muted/40" aria-busy />}>
          <CvStudio />
        </Suspense>
      ) : design ? (
        <StudioEditor language={locale} />
      ) : document ? (
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

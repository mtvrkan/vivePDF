import { useEffect, useRef, useState } from "react";
import { ChevronRight, Clock, FolderOpen, IdCard, Play, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { useUiStore } from "@/shared/store/uiStore";
import type { StudioDesign } from "@/types/studio";
import { CV_LAYOUT_IDS } from "../cv/cvModel";
import { useCvStore } from "../cv/cvStore";
import { NumberField } from "../design/controls";
import { PageView } from "../design/ElementView";
import { pickDesignFile } from "../design/projectFile";
import { useRecentDesignsStore, type RecentDesign } from "../design/recentDesigns";
import { fromMm, toMm } from "../design/units";
import { useOpenDesign } from "../design/useOpenDesign";
import { useStudioDraft } from "../design/useStudioDraft";
import { DocumentDraftCard, DocumentStart } from "../document/DocumentStart";
import { useDocumentStore } from "../document/documentStore";
import { buildStarter, DOCUMENT_STARTERS } from "../document/starters";
import { CARD_SIZES, createCardDesign } from "../model/cards";
import { STUDIO_PAGE_SIZES, createDesign, type StudioPageSize } from "../model/design";
import { CATEGORY_ICONS, TEMPLATE_CATEGORIES, type TemplateFilter } from "../templates/categories";
import { buildTemplate } from "../templates/kit";
import { LazyTemplateGallery } from "../templates/LazyTemplateGallery";
import { SECTION_ICONS, SECTION_TONES } from "./sectionLook";
import { STUDIO_SECTIONS, useStudioSectionStore, type StudioSection } from "./studioSection";
import { useTemplateCounts } from "./useTemplateCounts";

const START_SIZES: StudioPageSize[] = ["a4", "a4Landscape", "a5", "letter", "square", "story", "presentation", "poster"];
const PREVIEW_BOX = 96;
const QUICK_SECTIONS = ["document", "design", "card", "cv"] as const;
const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

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

function DraftCard({ onOpen }: { onOpen: (design: StudioDesign, filePath?: string | null) => void }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const { state, retry } = useStudioDraft();
  if (state.status === "loading") {
    return (
      <div className="card glass-tinted flex items-center gap-4 rounded-xl p-4" aria-busy data-testid="studio-draft-loading">
        <span className="size-16 shrink-0 animate-pulse rounded-md bg-muted" aria-hidden />
        <span className="min-w-0 flex-1 space-y-2" aria-hidden>
          <span className="block h-4 w-1/2 animate-pulse rounded bg-muted" />
          <span className="block h-4 w-1/3 animate-pulse rounded bg-muted" />
        </span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <section className="card glass-tinted flex flex-wrap items-center gap-4 rounded-xl p-4" aria-label={t("studio.start.continue")} role="alert">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("studio.draft.loadFailed")}</p>
          <p className="text-sm text-muted-foreground">{describeError(t, state.error)}</p>
        </div>
        <Button icon={<RotateCw className="size-4" aria-hidden />} onClick={retry}>
          {t("common.retry")}
        </Button>
      </section>
    );
  }
  const draft = state.draft;
  const firstPage = draft?.design.pages[0];
  if (!draft || !firstPage) return null;
  const previewScale = PREVIEW_BOX / Math.max(firstPage.width, firstPage.height);
  return (
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
  );
}

function SectionTile({ section, size = "sm" }: { section: StudioSection; size?: "sm" | "md" }) {
  const Icon = SECTION_ICONS[section];
  return (
    <span className={cn("tone-tile flex shrink-0 items-center justify-center", size === "sm" ? "size-6 rounded-md" : "size-10 rounded-xl")} data-tone={SECTION_TONES[section]} aria-hidden>
      <Icon className={size === "sm" ? "size-3.5" : "size-5"} />
    </span>
  );
}

function StudioNav({ opening, onBrowse }: { opening: boolean; onBrowse: () => void }) {
  const { t } = useTranslation();
  const { section, templateFilter, select } = useStudioSectionStore();
  const counts = useTemplateCounts();
  const sizes: Record<StudioSection, number | null> = {
    home: null,
    document: DOCUMENT_STARTERS.length,
    design: START_SIZES.length,
    card: CARD_SIZES.length,
    cv: CV_LAYOUT_IDS.length,
    templates: counts?.total ?? null,
  };
  const row = "flex w-full items-center gap-2.5 rounded-lg px-2 text-start outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring";
  const idle = "text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground";
  return (
    <nav aria-label={t("studio.start.navLabel")} className="glass-flat flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-border/60 p-3" data-testid="studio-nav">
      <Button variant="primary" icon={<FolderOpen className="size-4" aria-hidden />} loading={opening} onClick={onBrowse} className="mb-3 w-full">
        {t("studio.project.open")}
      </Button>
      {STUDIO_SECTIONS.map((item) => {
        const active = section === item && (item !== "templates" || templateFilter === "all");
        return (
          <button
            key={item}
            type="button"
            aria-current={active ? "page" : undefined}
            data-studio-section={item}
            onClick={() => select(item)}
            className={cn(row, "h-9 text-sm", active ? "menubar-active font-medium text-foreground" : idle)}
          >
            <SectionTile section={item} />
            <span className="min-w-0 flex-1 truncate">{t(`studio.start.sections.${item}`)}</span>
            {sizes[item] !== null ? <span className="font-mono text-2xs tabular-nums text-muted-foreground">{sizes[item]}</span> : null}
          </button>
        );
      })}
      <div role="group" aria-label={t("studio.templates.categoriesLabel")} className="mt-0.5 space-y-0.5">
        {TEMPLATE_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category];
          const active = section === "templates" && templateFilter === category;
          return (
            <button
              key={category}
              type="button"
              aria-current={active ? "page" : undefined}
              data-template-category={category}
              onClick={() => select("templates", category)}
              className={cn(row, "h-8 ps-6 text-xs", active ? "menubar-active font-medium text-foreground" : idle)}
            >
              <Icon className={cn("size-3.5 shrink-0", active && "text-primary")} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t(`studio.templates.categories.${category}`)}</span>
              {counts ? <span className="font-mono text-2xs tabular-nums text-muted-foreground">{counts.byCategory.get(category) ?? 0}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SectionHeading({ section, templateFilter }: { section: StudioSection; templateFilter: TemplateFilter }) {
  const { t } = useTranslation();
  const category = section === "templates" && templateFilter !== "all" ? templateFilter : null;
  const title = section === "home" ? t("studio.title") : category ? t(`studio.templates.categories.${category}`) : t(`studio.start.sections.${section}`);
  const hint = section === "home" ? t("studio.description") : category ? t("studio.start.sections.templates") : t(`studio.start.hints.${section}`);
  return (
    <header className="flex items-center gap-3">
      {section === "home" ? null : <SectionTile section={section} size="md" />}
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </header>
  );
}

function HomeSection({ onOpen, locale, opening, openDesign }: { onOpen: (design: StudioDesign, filePath?: string | null) => void; locale: string; opening: boolean; openDesign: (path: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const recent = useRecentDesignsStore((state) => state.items);
  const select = useStudioSectionStore((state) => state.select);
  return (
    <>
      <div className="space-y-3">
        <DraftCard onOpen={onOpen} />
        <DocumentDraftCard />
      </div>
      <section className="space-y-3" aria-labelledby="studio-quick">
        <h2 id="studio-quick" className="text-base font-semibold">
          {t("studio.start.quick")}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {QUICK_SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              data-quick-start={section}
              onClick={() => select(section)}
              className="card glass-tinted group flex items-center gap-3 rounded-xl p-4 text-start hover:ring-2 hover:ring-primary/40"
            >
              <SectionTile section={section} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t(`studio.start.sections.${section}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`studio.start.hints.${section}`)}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--transition-fast) group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden />
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-3" aria-labelledby="studio-recent">
        <h2 id="studio-recent" className="text-base font-semibold">
          {t("studio.project.recent")}
        </h2>
        {recent.length ? (
          <ul className={GRID}>
            {recent.map((item) => (
              <RecentCard key={item.path} item={item} locale={locale} busy={opening} onOpen={() => void openDesign(item.path)} />
            ))}
          </ul>
        ) : (
          <div className="card glass-tinted rounded-xl">
            <EmptyState
              icon={Clock}
              title={t("studio.start.recentEmptyTitle")}
              description={t("studio.start.recentEmptyBody")}
              action={
                <Button variant="primary" onClick={() => useDocumentStore.getState().open(buildStarter("blank", t, locale))}>
                  {t("studio.start.recentEmptyAction")}
                </Button>
              }
            />
          </div>
        )}
      </section>
    </>
  );
}

export function StudioStart({ onOpen }: { onOpen: (design: StudioDesign, filePath?: string | null) => void }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const { section, templateFilter, select } = useStudioSectionStore();
  const { opening, openDesign } = useOpenDesign();
  const scroller = useRef<HTMLDivElement>(null);
  const browse = async () => {
    const path = await pickDesignFile(t("studio.project.filter"));
    if (path) await openDesign(path);
  };
  const [custom, setCustom] = useState({ width: 210, height: 297 });
  const create = (width: number, height: number) => onOpen(createDesign("", width, height));

  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 });
  }, [section, templateFilter]);

  return (
    <div className="flex h-full min-h-0">
      <StudioNav opening={opening !== null} onBrowse={() => void browse()} />
      <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 md:px-8" data-studio-page={section}>
          <SectionHeading section={section} templateFilter={templateFilter} />
          {section === "home" ? <HomeSection onOpen={onOpen} locale={locale} opening={opening !== null} openDesign={openDesign} /> : null}
          {section === "document" ? <DocumentStart language={locale} /> : null}
          {section === "design" ? (
            <>
              <section className="space-y-3">
                <h2 className="text-base font-semibold">{t("studio.start.blank")}</h2>
                <div className={GRID}>
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
            </>
          ) : null}
          {section === "card" ? (
            <div className={GRID}>
              {CARD_SIZES.map((size) => (
                <SizeCard key={size} size={size} onPick={() => onOpen(createCardDesign(size, { front: t("studio.page.front"), back: t("studio.page.back") }))} />
              ))}
            </div>
          ) : null}
          {section === "cv" ? (
            <section className="card glass-tinted flex flex-wrap items-center gap-4 rounded-xl p-4" aria-labelledby="studio-cv">
              <span className="tone-tile flex size-12 shrink-0 items-center justify-center rounded-xl" data-tone="toPdf" aria-hidden>
                <IdCard className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="studio-cv" className="text-sm font-semibold">
                  {t("studio.cv.startTitle")}
                </h2>
                <p className="text-sm text-muted-foreground">{t("studio.cv.startDescription", { count: CV_LAYOUT_IDS.length })}</p>
              </div>
              <Button variant="primary" icon={<IdCard className="size-4" aria-hidden />} onClick={() => useCvStore.getState().open(locale)} data-testid="studio-cv-start">
                {t("studio.cv.start")}
              </Button>
            </section>
          ) : null}
          {section === "templates" ? (
            <LazyTemplateGallery
              language={locale}
              box={140}
              navigation={false}
              filter={templateFilter}
              onFilterChange={(filter) => select("templates", filter)}
              onPick={(template) => onOpen(buildTemplate(template, t, locale))}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

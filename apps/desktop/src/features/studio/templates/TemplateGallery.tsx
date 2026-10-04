import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Award, BookOpen, Briefcase, CalendarHeart, ChevronRight, Contact, GraduationCap, IdCard, LayoutGrid, LayoutTemplate, MailOpen, Megaphone, Newspaper, Search, Share2, Tag, UtensilsCrossed, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/shared/lib/cn";
import type { StudioDesign } from "@/types/studio";
import { PageView } from "../design/ElementView";
import { buildTemplate, STUDIO_TEMPLATES, TEMPLATE_CATEGORIES } from "./catalog";
import { sizeOf, type StudioTemplate, type TemplateCategory, type Translate } from "./kit";
import { useTemplateThumbnail } from "./thumbnails";

const previews = new Map<string, StudioDesign>();
const CARD_CHROME = 48;
const CARD_PADDING = 26;
const GRID_GAP = 12;
const NARROW_SECTION_ROWS = 2;
const MIN_SECTION_LIMIT = 2;
const WIDE_BOX = 140;

const CATEGORY_ICONS: Record<TemplateCategory, LucideIcon> = {
  resumes: IdCard,
  certificates: Award,
  invitations: MailOpen,
  social: Share2,
  posters: Megaphone,
  flyers: Newspaper,
  covers: BookOpen,
  business: Briefcase,
  cards: Contact,
  menus: UtensilsCrossed,
  education: GraduationCap,
  personal: CalendarHeart,
  labels: Tag,
};

function previewOf(template: StudioTemplate, t: Translate, language: string): StudioDesign {
  const key = `${template.id}|${language}`;
  let design = previews.get(key);
  if (!design) {
    design = buildTemplate(template, t, language);
    previews.set(key, design);
  }
  return design;
}

const TemplateCard = memo(function TemplateCard({ template, box, language, onPick }: { template: StudioTemplate; box: number; language: string; onPick: (template: StudioTemplate) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const { width, height } = sizeOf(template.size);
  const scale = box / Math.max(width, height);
  const name = t(`studio.templates.items.${template.id}`);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setVisible(true);
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const pageOf = useCallback(() => previewOf(template, t, language).pages[0], [template, t, language]);
  const thumbnail = useTemplateThumbnail(template.id, visible ? pageOf : null, language, box);
  const page = thumbnail.status === "error" ? pageOf() : null;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onPick(template)}
      data-template={template.id}
      title={name}
      style={{ "--template-card-height": `${box + CARD_CHROME}px` } as CSSProperties}
      className="card template-card flex flex-col items-center gap-2 rounded-xl p-3 text-center hover:ring-2 hover:ring-primary/40"
    >
      <span className="flex items-center justify-center" style={{ width: `${box}px`, height: `${box}px` }} aria-hidden>
        <span className="paper-surface relative block overflow-hidden rounded-sm border border-border bg-white shadow-sm" style={{ width: `${width * scale}px`, height: `${height * scale}px` }}>
          {thumbnail.status === "ready" ? (
            <img src={thumbnail.url} alt="" draggable={false} decoding="async" className="block size-full" />
          ) : page ? (
            <span className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
              <PageView page={page} language={language} />
            </span>
          ) : (
            <span className="block size-full animate-pulse bg-muted" />
          )}
        </span>
      </span>
      <span className="w-full truncate text-xs font-medium">{name}</span>
    </button>
  );
});

type Filter = TemplateCategory | "all";

function useColumns(box: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  });
  return { ref, count: Math.max(1, Math.floor((width + GRID_GAP) / (box + CARD_PADDING + GRID_GAP))) };
}

function CategoryButton({ filter, count, active, onSelect }: { filter: Filter; count: number; active: boolean; onSelect: (filter: Filter) => void }) {
  const { t } = useTranslation();
  const Icon = filter === "all" ? LayoutGrid : CATEGORY_ICONS[filter];
  return (
    <button
      type="button"
      aria-pressed={active}
      data-template-category={filter}
      onClick={() => onSelect(filter)}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-sm outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
        active ? "menubar-active font-medium text-foreground" : "text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{filter === "all" ? t("studio.templates.all") : t(`studio.templates.categories.${filter}`)}</span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function CategoryChip({ filter, active, onSelect }: { filter: Filter; active: boolean; onSelect: (filter: Filter) => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-pressed={active}
      data-template-category={filter}
      onClick={() => onSelect(filter)}
      className={cn("rounded-full border px-2.5 py-1 text-xs", active ? "glass-chip border-primary/40 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
    >
      {filter === "all" ? t("studio.templates.all") : t(`studio.templates.categories.${filter}`)}
    </button>
  );
}

function CardGrid({ templates, box, language, onPick }: { templates: StudioTemplate[]; box: number; language: string; onPick: (template: StudioTemplate) => void }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${box + CARD_PADDING}px, 1fr))` }}>
      {templates.map((template) => (
        <TemplateCard key={template.id} template={template} box={box} language={language} onPick={onPick} />
      ))}
    </div>
  );
}

export function TemplateGallery({ language, box, onPick, className }: { language: string; box: number; onPick: (template: StudioTemplate) => void; className?: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const needle = query.trim().toLocaleLowerCase(language);
  const wide = box >= WIDE_BOX;
  const columns = useColumns(box);
  const sectionLimit = Math.max(MIN_SECTION_LIMIT, columns.count * (wide ? 1 : NARROW_SECTION_ROWS));

  const matching = useMemo(
    () =>
      STUDIO_TEMPLATES.filter((template) => {
        if (!needle) return true;
        const haystack = `${t(`studio.templates.items.${template.id}`)} ${t(`studio.templates.categories.${template.category}`)}`.toLocaleLowerCase(language);
        return haystack.includes(needle);
      }),
    [needle, language, t],
  );

  const byCategory = useMemo(() => {
    const groups = new Map<TemplateCategory, StudioTemplate[]>(TEMPLATE_CATEGORIES.map((category) => [category, []]));
    for (const template of matching) groups.get(template.category)?.push(template);
    return groups;
  }, [matching]);

  const shown = filter === "all" ? matching : (byCategory.get(filter) ?? []);
  const sections = filter === "all" && !needle ? TEMPLATE_CATEGORIES.filter((category) => (byCategory.get(category)?.length ?? 0) > 0) : null;
  const filters: Filter[] = ["all", ...TEMPLATE_CATEGORIES];
  const countOf = (item: Filter) => (item === "all" ? matching.length : (byCategory.get(item)?.length ?? 0));

  const reset = () => {
    setQuery("");
    setFilter("all");
  };

  const search = (
    <label className="glass-flat relative flex h-9 w-full items-center rounded-lg border ps-9">
      <Search className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("studio.templates.search")}
        aria-label={t("studio.templates.search")}
        className="h-full w-full bg-transparent pe-9 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button type="button" onClick={() => setQuery("")} aria-label={t("studio.templates.clearSearch")} className="absolute end-2 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </label>
  );

  const chips = (
    <div className={cn("flex flex-wrap gap-1.5", wide && "@3xl:hidden")} role="group" aria-label={t("studio.templates.categoriesLabel")}>
      {filters.map((item) => (
        <CategoryChip key={item} filter={item} active={filter === item} onSelect={setFilter} />
      ))}
    </div>
  );

  const results = sections ? (
    <div ref={columns.ref} className="space-y-6">
      {sections.map((category) => {
        const Icon = CATEGORY_ICONS[category];
        const items = byCategory.get(category) ?? [];
        const name = t(`studio.templates.categories.${category}`);
        return (
          <section key={category} aria-label={name} className="space-y-2.5" data-template-section={category}>
            <div className="flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-primary" aria-hidden />
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h3>
              {items.length > sectionLimit ? (
                <button
                  type="button"
                  onClick={() => setFilter(category)}
                  aria-label={t("studio.templates.seeAllIn", { category: name, total: items.length })}
                  className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-(--hover-bg)"
                >
                  {t("studio.templates.seeAll", { total: items.length })}
                  <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
                </button>
              ) : null}
            </div>
            <CardGrid templates={items.slice(0, sectionLimit)} box={box} language={language} onPick={onPick} />
          </section>
        );
      })}
    </div>
  ) : shown.length ? (
    <CardGrid templates={shown} box={box} language={language} onPick={onPick} />
  ) : (
    <EmptyState
      icon={LayoutTemplate}
      title={t("studio.templates.noResults")}
      description={t("studio.templates.noResultsHint")}
      action={
        <button type="button" onClick={reset} className="text-sm font-medium text-primary hover:underline">
          {t("studio.templates.showAll")}
        </button>
      }
    />
  );

  if (!wide) {
    return (
      <div className={cn("space-y-3", className)}>
        {search}
        {chips}
        {results}
      </div>
    );
  }

  return (
    <div className={cn("@container", className)}>
      <div className="grid gap-5 @3xl:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label={t("studio.templates.categoriesLabel")} className="hidden @3xl:block">
          <div className="sticky top-0 space-y-0.5">
            {filters.map((item) => (
              <CategoryButton key={item} filter={item} count={countOf(item)} active={filter === item} onSelect={setFilter} />
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-3">
          {search}
          {chips}
          {results}
        </div>
      </div>
    </div>
  );
}

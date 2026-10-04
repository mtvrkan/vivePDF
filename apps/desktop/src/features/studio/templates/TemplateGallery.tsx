import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LayoutTemplate, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/shared/lib/cn";
import type { StudioDesign } from "@/types/studio";
import { PageView } from "../design/ElementView";
import { buildTemplate, STUDIO_TEMPLATES, TEMPLATE_CATEGORIES } from "./catalog";
import { sizeOf, type StudioTemplate, type TemplateCategory, type Translate } from "./kit";

const previews = new Map<string, StudioDesign>();
const CARD_CHROME = 48;

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

  const design = visible ? previewOf(template, t, language) : null;
  const page = design?.pages[0];

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
          {page ? (
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

export function TemplateGallery({ language, box, onPick, className }: { language: string; box: number; onPick: (template: StudioTemplate) => void; className?: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const needle = query.trim().toLocaleLowerCase(language);

  const shown = useMemo(
    () =>
      STUDIO_TEMPLATES.filter((template) => {
        if (filter !== "all" && template.category !== filter) return false;
        if (!needle) return true;
        const haystack = `${t(`studio.templates.items.${template.id}`)} ${t(`studio.templates.categories.${template.category}`)}`.toLocaleLowerCase(language);
        return haystack.includes(needle);
      }),
    [filter, needle, language, t],
  );

  const filters: Filter[] = ["all", ...TEMPLATE_CATEGORIES];

  return (
    <div className={cn("space-y-3", className)}>
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
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("studio.templates.categoriesLabel")}>
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={filter === item}
            data-template-category={item}
            onClick={() => setFilter(item)}
            className={cn("rounded-full border px-2.5 py-1 text-xs", filter === item ? "glass-chip border-primary/40 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {item === "all" ? t("studio.templates.all") : t(`studio.templates.categories.${item}`)}
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${box + 26}px, 1fr))` }}>
          {shown.map((template) => (
            <TemplateCard key={template.id} template={template} box={box} language={language} onPick={onPick} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={LayoutTemplate}
          title={t("studio.templates.noResults")}
          description={t("studio.templates.noResultsHint")}
          action={
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("studio.templates.showAll")}
            </button>
          }
        />
      )}
    </div>
  );
}

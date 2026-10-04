import { useMemo, useRef, useState } from "react";
import { ChevronRight, SearchX, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Dialog } from "@/components/shared/Dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { cn } from "@/shared/lib/cn";
import { useInView } from "../design/useInView";
import { IconGrid } from "./IconGrid";
import { insertIcon } from "./insertIcon";
import { ICON_CATEGORIES, ICON_CONCEPTS, searchIcons, type IconCategory, type IconEntry, type LocalTerms } from "./iconSearch";
import { useIconLibrary, type IconLibrary } from "./useIconLibrary";

const PANEL_ICONS = 12;
const PANEL_COLUMNS = 6;
const BROWSER_TILE = 84;
const BROWSER_HEIGHT = 420;

function localTerms(t: TFunction): LocalTerms {
  const terms: LocalTerms = {};
  const split = (value: string) => value.split(/[,،、，]/).map((part) => part.trim()).filter(Boolean);
  for (const concept of ICON_CONCEPTS) terms[concept] = split(t(`studio.icons.terms.${concept}`));
  for (const category of ICON_CATEGORIES) terms[category] = [...(terms[category] ?? []), t(`studio.icons.categories.${category}`)];
  return terms;
}

function useIconSearch(library: IconLibrary | null, query: string, category: IconCategory | null) {
  const { t } = useTranslation();
  const local = useMemo(() => localTerms(t), [t]);
  return useMemo(() => (library ? searchIcons(library.ICON_ENTRIES, query, { category, local }) : []), [library, query, category, local]);
}

function SearchField({ value, onChange, autoFocus }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  const { t } = useTranslation();
  return (
    <label className="glass-flat relative flex h-9 w-full items-center rounded-lg border ps-9">
      <Search className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("studio.icons.search")}
        aria-label={t("studio.icons.search")}
        data-testid="studio-icon-search"
        className="h-full w-full bg-transparent pe-9 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" onClick={() => onChange("")} aria-label={t("studio.icons.clearSearch")} className="absolute end-2 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </label>
  );
}

function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={SearchX}
      title={t("studio.icons.emptyTitle")}
      description={t("studio.icons.emptyHint", { query })}
      action={
        <button type="button" onClick={onClear} className="glass-chip h-8 rounded-lg px-3 text-sm font-medium">
          {t("studio.icons.clearSearch")}
        </button>
      }
    />
  );
}

function IconBrowser({ library, initialQuery, onClose }: { library: IconLibrary; initialQuery: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<IconCategory | null>(null);
  const results = useIconSearch(library, query, category);
  const pick = (entry: IconEntry) => {
    const node = library.iconNodeOf(entry.name);
    if (!node) return;
    insertIcon(entry, node);
    onClose();
  };
  const chip = (value: IconCategory | null) => (
    <button
      key={value ?? "all"}
      type="button"
      aria-pressed={category === value}
      data-icon-category={value ?? "all"}
      onClick={() => setCategory(value)}
      className={cn("rounded-full border px-2.5 py-1 text-xs", category === value ? "glass-chip border-primary/40 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
    >
      {value ? t(`studio.icons.categories.${value}`) : t("studio.icons.all")}
    </button>
  );
  return (
    <Dialog open title={t("studio.icons.library")} onClose={onClose} size="xl">
      <div className="space-y-3" data-testid="studio-icon-browser">
        <SearchField value={query} onChange={setQuery} autoFocus />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("studio.icons.categoriesLabel")}>
          {chip(null)}
          {ICON_CATEGORIES.map(chip)}
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {t("studio.icons.count", { count: results.length })}
        </p>
        {results.length ? (
          <IconGrid entries={results} preview={library.iconPreview} onPick={pick} labelOf={(entry) => t("studio.icons.insert", { name: entry.label })} ariaLabel={t("studio.icons.title")} tile={BROWSER_TILE} height={BROWSER_HEIGHT} showLabels />
        ) : (
          <NoMatches
            query={query}
            onClear={() => {
              setQuery("");
              setCategory(null);
            }}
          />
        )}
        <p className="text-xs text-muted-foreground">{t("studio.icons.credit")}</p>
      </div>
    </Dialog>
  );
}

function PanelSkeleton() {
  return (
    <div className="grid grid-cols-6 gap-2" aria-hidden data-testid="studio-icons-loading">
      {Array.from({ length: PANEL_ICONS }, (_, index) => (
        <span key={index} className="aspect-square animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export function IconsSection() {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref, null, "400px");
  const { state, retry } = useIconLibrary(visible);
  const library = state.status === "ready" ? state.library : null;
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const results = useIconSearch(library, query, null);
  const shown = useMemo(() => results.slice(0, PANEL_ICONS), [results]);
  const pick = (entry: IconEntry) => {
    const node = library?.iconNodeOf(entry.name);
    if (node) insertIcon(entry, node);
  };
  let body;
  if (state.status === "error") body = <ErrorState title={t("studio.icons.errorTitle")} message={t("studio.icons.errorHint")} onRetry={retry} />;
  else if (!library) body = <PanelSkeleton />;
  else if (!shown.length) body = <NoMatches query={query} onClear={() => setQuery("")} />;
  else body = <IconGrid entries={shown} preview={library.iconPreview} onPick={pick} labelOf={(entry) => t("studio.icons.insert", { name: entry.label })} ariaLabel={t("studio.icons.title")} tile={36} columns={PANEL_COLUMNS} gap={6} />;
  return (
    <section ref={ref} className="space-y-2" aria-busy={state.status === "loading"} data-testid="studio-icons">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.icons.title")}</h3>
        <button
          type="button"
          onClick={() => setBrowsing(true)}
          disabled={!library}
          className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-(--hover-bg) disabled:opacity-50"
        >
          {t("studio.icons.seeAll")}
          <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
        </button>
      </div>
      <SearchField value={query} onChange={setQuery} />
      {body}
      {browsing && library ? <IconBrowser library={library} initialQuery={query} onClose={() => setBrowsing(false)} /> : null}
    </section>
  );
}

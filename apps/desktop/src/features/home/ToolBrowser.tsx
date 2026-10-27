import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Check, LayoutGrid, Search, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toolGroupIcons, toolGroups, toolShortcuts, toolsInGroup, type ToolGroup, type ToolShortcut } from "@/app/navigation";
import { toolMatches } from "./homeSearch";
import { cn } from "@/shared/lib/cn";
import { useUiStore } from "@/shared/store/uiStore";

const SHOWN_LIMIT = 12;

type ToolBrowserProps = {
  title?: string;
  collapsible?: boolean;
  grouped?: boolean;
  onSelect?: () => void;
  limit?: number;
  onPick?: (tool: ToolShortcut) => void;
  isPicked?: (tool: ToolShortcut) => boolean;
};

const TOOL_CARD_CLASS =
  "flex items-center gap-3 rounded-xl border border-(--glass-border) bg-card/40 p-2.5 text-start outline-none transition-colors duration-(--transition-fast) tone-hover focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60";

function ToolCard({ tool, onSelect, onPick, picked, roomy = false }: { tool: ToolShortcut; onSelect?: () => void; onPick?: (tool: ToolShortcut) => void; picked?: boolean; roomy?: boolean }) {
  const { t } = useTranslation();
  const Icon = tool.icon;
  const content = (
    <>
      <span className="tone-tile flex size-9 shrink-0 items-center justify-center rounded-xl">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{t(tool.labelKey)}</span>
        <span title={t(tool.descriptionKey)} className={cn("block text-xs text-muted-foreground", roomy ? "line-clamp-2" : "truncate")}>{t(tool.descriptionKey)}</span>
      </span>
      {picked ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
    </>
  );
  if (onPick)
    return (
      <button type="button" onClick={() => onPick(tool)} disabled={picked} aria-pressed={picked} data-tone={tool.group} className={cn(TOOL_CARD_CLASS, roomy && "items-start")}>
        {content}
      </button>
    );
  return (
    <Link to={tool.route} onClick={onSelect} data-tone={tool.group} data-tool-card={tool.id} className={cn(TOOL_CARD_CLASS, roomy && "items-start")}>
      {content}
    </Link>
  );
}

function CategoryButton({ icon: Icon, label, count, tone, pressed, onClick, strip }: { icon: LucideIcon; label: string; count: number; tone: ToolGroup | undefined; pressed: boolean; onClick: () => void; strip: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-tone={strip && !pressed ? undefined : tone}
      data-catalog-category={tone ?? "all"}
      onClick={onClick}
      className={cn(
        "flex items-center outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
        strip ? "h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs font-medium" : "h-9 w-full gap-2.5 rounded-lg px-2 text-sm",
        strip && (pressed ? "glass-chip glass-chip-tone text-(--chip-tone-text)" : "glass-chip text-foreground/75 hover:text-foreground"),
        !strip && (pressed ? "tone-active font-medium text-foreground" : "text-foreground/85 hover:bg-(--hover-bg) hover:text-foreground"),
      )}
    >
      {strip ? (
        <span data-tone={tone} className="flex">
          <Icon className="size-3.5 shrink-0 text-(--tone)" aria-hidden />
        </span>
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-(--tone-soft) text-(--tone)" aria-hidden>
          <Icon className="size-3.5" />
        </span>
      )}
      <span className={cn("whitespace-nowrap", !strip && "min-w-0 flex-1 truncate text-start")}>{label}</span>
      <span className={cn("tabular-nums", strip ? "opacity-60" : "font-mono text-2xs text-muted-foreground")}>{count}</span>
    </button>
  );
}

function SectionTitle({ group, count }: { group: ToolGroup; count: number }) {
  const { t } = useTranslation();
  const GroupIcon = toolGroupIcons[group];
  return (
    <p className="flex items-center gap-2 px-0.5 pb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      <GroupIcon className="size-3.5 text-(--tone)" aria-hidden />
      <span className="truncate">{t(`tools.grid.groups.${group}`)}</span>
      <span className="font-mono tabular-nums">{count}</span>
    </p>
  );
}

export function ToolBrowser({ title, collapsible = false, grouped = false, onSelect, limit = SHOWN_LIMIT, onPick, isPicked }: ToolBrowserProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ToolGroup | "all">("all");
  const [showAll, setShowAll] = useState(false);

  const results = useMemo(
    () => toolShortcuts.filter((tool) => toolMatches(tool, query, locale, t(tool.labelKey), t(tool.descriptionKey), grouped ? "all" : group)),
    [query, locale, group, grouped, t],
  );
  const sections = useMemo(
    () => toolGroups.map((item) => ({ group: item, items: results.filter((tool) => tool.group === item) })).filter((section) => section.items.length > 0),
    [results],
  );
  const collapse = collapsible && query.trim() === "" && group === "all" && results.length > limit;
  const shown = collapse && !showAll ? results.slice(0, limit) : results;
  const catalogSections = toolGroups.map((item) => ({ group: item, items: shown.filter((tool) => tool.group === item) })).filter((section) => section.items.length > 0);
  const categoryButtons = (strip: boolean) => [
    <CategoryButton key="all" icon={LayoutGrid} label={t("home.catalog.all")} count={toolShortcuts.length} tone={undefined} pressed={group === "all"} onClick={() => setGroup("all")} strip={strip} />,
    ...toolGroups.map((toolGroup) => (
      <CategoryButton key={toolGroup} icon={toolGroupIcons[toolGroup]} label={t(`tools.grid.groups.${toolGroup}`)} count={toolsInGroup(toolGroup).length} tone={toolGroup} pressed={group === toolGroup} onClick={() => setGroup(toolGroup)} strip={strip} />
    )),
  ];

  return (
    <div className="@container">
      <div className={cn("flex flex-wrap items-center gap-3", title ? "justify-between" : "justify-end")}>
        {title ? <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p> : null}
        <label className="field flex h-9 w-72 max-w-full items-center gap-2.5 rounded-full px-3.5 text-sm">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("home.catalog.search")}
            aria-label={t("home.catalog.search")}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label={t("common.close")} className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </label>
      </div>

      {grouped && results.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t("home.catalog.empty")}</p> : null}

      {results.length > 0 && grouped ? (
        <div className="mt-4 space-y-5">
          {sections.map((section) => (
            <section key={section.group} data-tone={section.group}>
              <SectionTitle group={section.group} count={section.items.length} />
              <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:grid-cols-3">
                {section.items.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} onSelect={onSelect} onPick={onPick} picked={isPicked?.(tool)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {grouped ? null : (
        <div className="mt-4 @xl:grid @xl:grid-cols-[13rem_minmax(0,1fr)] @xl:border-t @xl:border-border">
          <nav aria-label={t("tools.menu.categories")} className="hidden flex-col gap-0.5 border-e border-border py-2.5 pe-2 @xl:flex" data-testid="catalog-categories">
            {categoryButtons(false)}
          </nav>
          <nav aria-label={t("tools.menu.categories")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] @xl:hidden" data-testid="catalog-category-strip">
            {categoryButtons(true)}
          </nav>
          <div className="@container min-w-0 pt-4 @xl:ps-4 @xl:pt-3" data-tone={group === "all" ? undefined : group} data-testid="catalog-tools">
            {shown.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t("home.catalog.empty")}</p> : null}
            <div className="space-y-4">
              {catalogSections.map((section) => (
                <section key={section.group} data-tone={section.group}>
                  <SectionTitle group={section.group} count={group === "all" && !query.trim() ? toolsInGroup(section.group).length : section.items.length} />
                  <div className="grid grid-cols-1 gap-2.5 @lg:grid-cols-2">
                    {section.items.map((tool) => (
                      <ToolCard key={tool.id} tool={tool} onSelect={onSelect} onPick={onPick} picked={isPicked?.(tool)} roomy />
                    ))}
                  </div>
                </section>
              ))}
            </div>
        {collapse ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="glass-chip rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground"
            >
              {showAll ? t("home.showLess") : `${t("home.showAll")} · ${results.length}`}
            </button>
          </div>
        ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

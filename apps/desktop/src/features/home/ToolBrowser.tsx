import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toolGroupIcons, toolGroups, toolShortcuts, type ToolGroup, type ToolShortcut } from "@/app/navigation";
import { toolMatches } from "./homeSearch";
import { cn } from "@/shared/lib/cn";
import { useUiStore } from "@/shared/store/uiStore";

const SHOWN_LIMIT = 12;

type ToolBrowserProps = {
  title?: string;
  collapsible?: boolean;
  grouped?: boolean;
  onSelect?: () => void;
};

function ToolCard({ tool, onSelect }: { tool: ToolShortcut; onSelect?: () => void }) {
  const { t } = useTranslation();
  const Icon = tool.icon;
  return (
    <Link
      to={tool.route}
      onClick={onSelect}
      data-tone={tool.group}
      className="flex items-center gap-3 rounded-xl border border-(--glass-border) bg-card/40 p-2.5 outline-none transition-colors duration-(--transition-fast) hover:border-(--tone)/50 hover:bg-(--tone-soft) focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="tone-tile flex size-9 shrink-0 items-center justify-center rounded-xl">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{t(tool.labelKey)}</span>
        <span title={t(tool.descriptionKey)} className="block truncate text-xs text-muted-foreground">{t(tool.descriptionKey)}</span>
      </span>
    </Link>
  );
}

export function ToolBrowser({ title, collapsible = false, grouped = false, onSelect }: ToolBrowserProps) {
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
  const collapse = collapsible && query.trim() === "" && group === "all" && results.length > SHOWN_LIMIT;
  const shown = collapse && !showAll ? results.slice(0, SHOWN_LIMIT) : results;

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-3", title ? "justify-between" : "justify-end")}>
        {title ? <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p> : null}
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

      {grouped ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={group === "all"}
            onClick={() => setGroup("all")}
            className={cn("flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors duration-(--transition-fast)", group === "all" ? "glass-chip glass-chip-tone text-foreground" : "glass-chip text-foreground/75 hover:text-foreground")}
          >
            {t("home.catalog.all")} · {toolShortcuts.length}
          </button>
          {toolGroups.map((toolGroup) => {
            const Icon = toolGroupIcons[toolGroup];
            const count = toolShortcuts.filter((tool) => tool.group === toolGroup).length;
            return (
              <button
                key={toolGroup}
                type="button"
                aria-pressed={group === toolGroup}
                data-tone={group === toolGroup ? toolGroup : undefined}
                onClick={() => setGroup(toolGroup)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-(--transition-fast)",
                  group === toolGroup ? "glass-chip glass-chip-tone text-foreground" : "glass-chip text-foreground/75 hover:text-foreground",
                )}
              >
                <span data-tone={toolGroup} className="flex">
                  <Icon className={cn("size-3.5", group === toolGroup ? "text-(--tone)" : "text-(--tone) opacity-80")} aria-hidden />
                </span>
                {t(`tools.grid.groups.${toolGroup}`)} · {count}
              </button>
            );
          })}
        </div>
      )}

      {results.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t("home.catalog.empty")}</p> : null}

      {results.length > 0 && grouped ? (
        <div className="mt-4 space-y-5">
          {sections.map((section) => {
            const GroupIcon = toolGroupIcons[section.group];
            return (
              <section key={section.group} data-tone={section.group}>
                <p className="flex items-center gap-2 px-0.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <GroupIcon className="size-3.5 text-(--tone)" aria-hidden />
                  <span className="truncate">{t(`tools.grid.groups.${section.group}`)}</span>
                  <span className="font-mono tabular-nums">{section.items.length}</span>
                </p>
                <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
                  {section.items.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} onSelect={onSelect} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {results.length > 0 && !grouped ? (
        <div className="mt-4 grid grid-cols-2 gap-2.5 xl:grid-cols-3">
          {shown.map((tool) => (
            <ToolCard key={tool.id} tool={tool} onSelect={onSelect} />
          ))}
        </div>
      ) : null}

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
    </>
  );
}

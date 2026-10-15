import { useMemo, useState } from "react";
import { Keyboard, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { keyCombos, type ShortcutGroup } from "./shortcutGroups";

export function ShortcutList({ groups: source }: { groups: ShortcutGroup[] }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const language = i18n.language;
    const needle = query.trim().toLocaleLowerCase(language);
    if (!needle) return source;
    return source.map((group) => ({
      ...group,
      items: group.items.filter((item) => t(item.labelKey).toLocaleLowerCase(language).includes(needle) || item.keys.toLocaleLowerCase(language).includes(needle)),
    })).filter((group) => group.items.length > 0);
  }, [query, source, t, i18n.language]);

  return (
    <div className="space-y-4">
      <div className="glass-flat relative flex h-9 items-center rounded-lg border ps-9">
        <Search className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("about.shortcuts.search")}
          aria-label={t("about.shortcuts.search")}
          className="h-full w-full bg-transparent pe-3 text-sm text-start outline-none placeholder:text-muted-foreground"
        />
      </div>
      {groups.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("about.shortcuts.noMatch")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {groups.map((group) => (
            <div key={group.id} className={cn("rounded-xl border p-4", (group.id === "organizer" || group.id === "presentation" || group.id === "studio") && "col-span-2")}>
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <Keyboard className="size-3.5" aria-hidden />
                {t(`about.shortcuts.groups.${group.id}`)}
              </p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.keys} className="flex h-row items-center justify-between gap-4 border-b text-sm last:border-b-0">
                    <span className="truncate text-start" title={t(item.labelKey)}>
                      {t(item.labelKey)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {keyCombos(item.keys, t).map((combo, index) => (
                        <kbd key={index} className="rounded-sm border bg-background px-1.5 font-mono text-xs text-muted-foreground">
                          {combo}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { homeQuickActionIds, toolShortcuts } from "@/app/navigation";

export function QuickActions() {
  const { t } = useTranslation();
  const actions = homeQuickActionIds.map((id) => toolShortcuts.find((tool) => tool.id === id)).filter((tool) => tool !== undefined);

  return (
    <section>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.quickActions")}</p>
      <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
        {actions.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.id}
              to={tool.route}
              data-tone={tool.group}
              className="glass group flex h-24 flex-col items-center justify-center gap-2.5 rounded-2xl px-3 text-center outline-none transition-[transform,box-shadow] duration-(--transition-fast) hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="tone-tile flex size-10 items-center justify-center rounded-xl">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className="w-full truncate text-sm font-medium">{t(tool.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

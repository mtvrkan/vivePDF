import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toolShortcuts, type ToolShortcut } from "@/app/navigation";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { MAX_QUICK_ACTIONS, shiftQuickAction, withQuickAction, withoutQuickAction, type HomeSize } from "./homeLayout";
import { useHomeLayoutStore } from "./homeLayoutStore";
import { ToolBrowser } from "./ToolBrowser";

const GRID: Record<HomeSize, string> = {
  small: "grid-cols-3 @md:grid-cols-4 @2xl:grid-cols-6 @4xl:grid-cols-9",
  medium: "grid-cols-2 @xs:grid-cols-3 @3xl:grid-cols-6",
  large: "grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-4",
};
const TILE: Record<HomeSize, string> = { small: "min-h-16 gap-1.5 py-2", medium: "min-h-24 gap-2.5 py-3", large: "min-h-32 gap-3 py-4" };
const ICON_BOX: Record<HomeSize, string> = { small: "size-7 rounded-lg", medium: "size-10 rounded-xl", large: "size-12 rounded-2xl" };
const ICON: Record<HomeSize, string> = { small: "size-3.5", medium: "size-[18px]", large: "size-6" };
const LABEL: Record<HomeSize, string> = { small: "text-xs", medium: "text-sm", large: "text-base" };

export function QuickActions({ size = "medium", editing = false }: { size?: HomeSize; editing?: boolean }) {
  const { t } = useTranslation();
  const ids = useHomeLayoutStore((state) => state.layout.quickActions);
  const change = useHomeLayoutStore((state) => state.change);
  const [picking, setPicking] = useState(false);
  const actions = ids.map((id) => toolShortcuts.find((tool) => tool.id === id)).filter((tool): tool is ToolShortcut => tool !== undefined);
  const tileClass = cn("glass group flex flex-col items-center justify-center rounded-2xl px-3 text-center outline-none", TILE[size]);

  return (
    <section className="@container">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.quickActions")}</p>
      <ul className={cn("grid gap-3", GRID[size])}>
        {actions.map((tool, index) => {
          const Icon = tool.icon;
          const body = (
            <>
              <span className={cn("tone-tile flex items-center justify-center", ICON_BOX[size])}>
                <Icon className={ICON[size]} aria-hidden />
              </span>
              <span className={cn("line-clamp-2 w-full break-words leading-tight font-medium", LABEL[size])}>{t(tool.labelKey)}</span>
            </>
          );
          return (
            <li key={tool.id} className="relative" data-quick-action={tool.id}>
              {editing ? (
                <>
                  <div data-tone={tool.group} className={cn(tileClass, "border border-dashed border-(--glass-border)")}>
                    {body}
                  </div>
                  <span className="absolute inset-x-1 top-1 flex justify-between">
                    <span className="flex">
                      <IconButton icon={ArrowLeft} label={t("home.layout.quick.earlier", { name: t(tool.labelKey) })} disabled={index === 0} onClick={() => change((layout) => shiftQuickAction(layout, tool.id, -1))} />
                      <IconButton icon={ArrowRight} label={t("home.layout.quick.later", { name: t(tool.labelKey) })} disabled={index === actions.length - 1} onClick={() => change((layout) => shiftQuickAction(layout, tool.id, 1))} />
                    </span>
                    <IconButton icon={X} label={t("home.layout.quick.remove", { name: t(tool.labelKey) })} onClick={() => change((layout) => withoutQuickAction(layout, tool.id))} />
                  </span>
                </>
              ) : (
                <Link
                  to={tool.route}
                  data-tone={tool.group}
                  title={t(tool.labelKey)}
                  className={cn(tileClass, "transition-[transform,box-shadow] duration-(--transition-fast) hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
        {editing ? (
          <li>
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={ids.length >= MAX_QUICK_ACTIONS}
              title={ids.length >= MAX_QUICK_ACTIONS ? t("home.layout.quick.full", { count: MAX_QUICK_ACTIONS }) : undefined}
              className={cn(tileClass, "w-full border-2 border-dashed border-(--glass-border) text-muted-foreground hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50")}
            >
              <Plus className={ICON[size]} aria-hidden />
              <span className={cn("w-full truncate font-medium", LABEL[size])}>{t("home.layout.quick.add")}</span>
            </button>
          </li>
        ) : null}
      </ul>
      {!editing && actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("home.layout.quick.empty")}</p> : null}
      <Dialog open={picking} onClose={() => setPicking(false)} title={t("home.layout.quick.pickTitle")} size="xl">
        <p className="mb-3 text-sm text-muted-foreground">{t("home.layout.quick.pickHint", { count: ids.length, max: MAX_QUICK_ACTIONS })}</p>
        <ToolBrowser grouped onPick={(tool) => change((layout) => withQuickAction(layout, tool.id))} isPicked={(tool) => ids.includes(tool.id)} />
      </Dialog>
    </section>
  );
}

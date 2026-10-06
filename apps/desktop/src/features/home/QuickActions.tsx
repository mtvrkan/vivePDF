import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toolShortcuts, type ToolShortcut } from "@/app/navigation";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { MAX_QUICK_ACTIONS, moveQuickAction, shiftQuickAction, withQuickAction, withoutQuickAction, type HomeSize } from "./homeLayout";
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
  const layout = useHomeLayoutStore((state) => state.layout);
  const ids = layout.quickActions;
  const change = useHomeLayoutStore((state) => state.change);
  const [picking, setPicking] = useState(false);
  const [drag, setDrag] = useState<{ id: string; index: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = drag ? moveQuickAction(layout, drag.id, drag.index).quickActions : ids;
  const actions = shown.map((id) => toolShortcuts.find((tool) => tool.id === id)).filter((tool): tool is ToolShortcut => tool !== undefined);
  const tileClass = cn("glass group flex flex-col items-center justify-center rounded-2xl px-3 text-center outline-none", TILE[size]);

  const startDrag = (id: string, event: ReactPointerEvent<HTMLLIElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, index: ids.indexOf(id) });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLLIElement>) => {
    if (!drag) return;
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-quick-action]");
    if (!over || !listRef.current?.contains(over)) return;
    const index = shown.indexOf(over.dataset.quickAction ?? "");
    if (index >= 0 && index !== drag.index) setDrag({ ...drag, index });
  };

  const endDrag = () => {
    if (!drag) return;
    const { id, index } = drag;
    change((current) => moveQuickAction(current, id, index));
    setDrag(null);
  };

  return (
    <section className="@container">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.quickActions")}</p>
      <ul ref={listRef} className={cn("grid gap-3", GRID[size])}>
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
            <li
              key={tool.id}
              className={cn("relative", drag?.id === tool.id && "opacity-60")}
              data-quick-action={tool.id}
              onPointerDown={editing ? (event) => startDrag(tool.id, event) : undefined}
              onPointerMove={editing ? moveDrag : undefined}
              onPointerUp={editing ? endDrag : undefined}
              onPointerCancel={editing ? () => setDrag(null) : undefined}
            >
              {editing ? (
                <>
                  <div
                    data-tone={tool.group}
                    title={t("home.layout.quick.dragHint")}
                    className={cn(tileClass, "h-full cursor-grab touch-none select-none border border-dashed border-(--glass-border) pt-10", drag?.id === tool.id && "cursor-grabbing ring-2 ring-primary")}
                  >
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
                  className={cn(tileClass, "h-full transition-[transform,box-shadow] duration-(--transition-fast) hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring")}
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
              className={cn(tileClass, "h-full w-full border-2 border-dashed border-(--glass-border) text-muted-foreground hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50")}
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

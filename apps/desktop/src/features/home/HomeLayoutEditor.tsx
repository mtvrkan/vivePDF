import { useEffect, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, GripVertical, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Segmented } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { useToastStore } from "@/shared/store/toastStore";
import {
  HOME_REGIONS,
  HOME_SIZES,
  SIDEBAR_SIDES,
  SIDEBAR_WIDTHS,
  defaultHomeLayout,
  moveSection,
  sectionsIn,
  shiftSection,
  updateSection,
  type HomeRegion,
  type HomeSectionLayout,
} from "./homeLayout";
import { useHomeLayoutStore } from "./homeLayoutStore";

export const SECTION_TITLE_KEYS = {
  hero: "home.layout.sections.hero",
  quickActions: "home.quickActions",
  recent: "home.recent",
  studio: "home.studio.title",
  collections: "home.collections.title",
  tools: "home.catalog.title",
  continue: "home.lastSession",
  history: "home.history.title",
  stats: "home.stats.title",
} as const;

export function HomeEditBar() {
  const { t } = useTranslation();
  const layout = useHomeLayoutStore((state) => state.layout);
  const change = useHomeLayoutStore((state) => state.change);
  const replace = useHomeLayoutStore((state) => state.replace);
  const setEditing = useHomeLayoutStore((state) => state.setEditing);
  const toast = useToastStore((state) => state.push);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setEditing]);

  const reset = () => {
    const snapshot = layout;
    replace(defaultHomeLayout());
    toast("info", t("home.layout.resetDone"), { label: t("common.undo"), onClick: () => replace(snapshot) });
  };

  return (
    <div role="region" aria-label={t("home.layout.editing")} className="glass glass-tinted space-y-3 rounded-2xl p-4 shadow-lg">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("home.layout.editing")}</p>
          <p className="text-xs text-muted-foreground">{t("home.layout.editingHint")}</p>
        </div>
        <Button variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={reset}>
          {t("home.layout.reset")}
        </Button>
        <Button variant="primary" icon={<Check className="size-4" aria-hidden />} onClick={() => setEditing(false)}>
          {t("home.layout.done")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {t("home.layout.sidebarSide")}
          <Segmented size="sm" value={layout.sidebar.side} options={SIDEBAR_SIDES} labelOf={(value) => t(`home.layout.sides.${value}`)} onChange={(side) => change((current) => ({ ...current, sidebar: { ...current.sidebar, side } }))} ariaLabel={t("home.layout.sidebarSide")} />
        </span>
        <span className="flex items-center gap-2">
          {t("home.layout.sidebarWidth")}
          <Segmented size="sm" value={layout.sidebar.width} options={SIDEBAR_WIDTHS} labelOf={(value) => t(`home.layout.widths.${value}`)} onChange={(width) => change((current) => ({ ...current, sidebar: { ...current.sidebar, width } }))} ariaLabel={t("home.layout.sidebarWidth")} />
        </span>
      </div>
    </div>
  );
}

type FrameProps = {
  section: HomeSectionLayout;
  dragging: boolean;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
  interactive: boolean;
  children: ReactNode;
};

export function HomeSectionFrame({ section, dragging, onDragStart, onDragMove, onDragEnd, onDragCancel, interactive, children }: FrameProps) {
  const { t } = useTranslation();
  const layout = useHomeLayoutStore((state) => state.layout);
  const change = useHomeLayoutStore((state) => state.change);
  const title = t(SECTION_TITLE_KEYS[section.id]);
  const siblings = sectionsIn(layout, section.region);
  const index = siblings.findIndex((item) => item.id === section.id);

  return (
    <div data-testid={`home-frame-${section.id}`} className={cn("rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-2", dragging && "opacity-50")}>
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          aria-label={t("home.layout.dragHandle", { name: title })}
          title={t("home.layout.dragHint")}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
          className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <span title={title} className="min-w-32 flex-1 truncate text-sm font-semibold">{title}</span>
        <Segmented size="sm" value={section.size} options={HOME_SIZES} labelOf={(value) => t(`home.layout.sizes.${value}`)} onChange={(size) => change((current) => updateSection(current, section.id, { size }))} ariaLabel={t("home.layout.sizeOf", { name: title })} />
        <span className="w-28">
          <Select
            size="sm"
            value={section.region}
            options={HOME_REGIONS.map((region) => ({ value: region, label: t(`home.layout.regions.${region}`) }))}
            onChange={(region) => change((current) => moveSection(current, section.id, region as HomeRegion, Number.MAX_SAFE_INTEGER))}
            ariaLabel={t("home.layout.regionOf", { name: title })}
          />
        </span>
        <span className="flex">
          <IconButton icon={ArrowUp} label={t("home.layout.moveUp", { name: title })} disabled={index <= 0} onClick={() => change((current) => shiftSection(current, section.id, -1))} />
          <IconButton icon={ArrowDown} label={t("home.layout.moveDown", { name: title })} disabled={index < 0 || index >= siblings.length - 1} onClick={() => change((current) => shiftSection(current, section.id, 1))} />
          <IconButton icon={EyeOff} label={t("home.layout.hide", { name: title })} onClick={() => change((current) => updateSection(current, section.id, { hidden: true }))} />
        </span>
      </div>
      <div className="relative">
        <div className="peer" inert={!interactive || undefined}>
          {children}
        </div>
        <p className="hidden rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground peer-empty:block">{t("home.layout.emptySection")}</p>
      </div>
    </div>
  );
}

export function HiddenSectionFrame({ section }: { section: HomeSectionLayout }) {
  const { t } = useTranslation();
  const change = useHomeLayoutStore((state) => state.change);
  const title = t(SECTION_TITLE_KEYS[section.id]);

  return (
    <div data-testid={`home-frame-${section.id}`} data-hidden-section={section.id} className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-dashed border-(--glass-border) px-3 py-2 text-muted-foreground">
      <EyeOff className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold line-through decoration-1">{title}</span>
      <span className="text-xs">{t("home.layout.hiddenLabel")}</span>
      <Button size="sm" icon={<Eye className="size-4" aria-hidden />} onClick={() => change((current) => updateSection(current, section.id, { hidden: false }))} aria-label={t("home.layout.show", { name: title })}>
        {t("home.layout.showShort")}
      </Button>
    </div>
  );
}

export function DropLine() {
  return <div aria-hidden className="h-1 rounded-full bg-primary" />;
}

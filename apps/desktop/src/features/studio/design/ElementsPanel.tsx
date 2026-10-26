import { lazy, memo, Suspense, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChartColumn, File, Flower2, Image as ImageIcon, Layers, LayoutTemplate, PanelLeftClose, QrCode, Shapes, Smile, Table2, Type, type LucideIcon } from "lucide-react";
import { IconButton } from "@/components/shared/IconButton";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { studioImportSvg } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { createImage, createQr, createSvg, createVector } from "../model/design";
import { DEFAULT_COLOURS, ORNAMENTS, paletteColours, type Ornament, type OrnamentCategory } from "../ornaments/ornaments";
import { loadImagePreview } from "./assets";
import { PathsSvg } from "./ElementView";
import { centred, insert, insertShape, insertText, presetShape, SHAPE_PRESETS, TEXT_PRESETS, type ShapePreset, type TextPreset } from "./insert";
import { pickImage } from "./pickImage";
import { isLineShape, renderFill, renderStroke, shapePaths } from "../model/shapes";
import { currentPage, useStudioStore } from "./studioStore";
import { DesignColours } from "./ColorSections";
import { PageProperties } from "./PageSection";
import { useSidePanelsStore } from "./sidePanels";
import { insertTemplate } from "../templates/apply";
import { buildTemplate } from "../templates/kit";
import type { StudioTemplate } from "../templates/kit";
import { LazyTemplateGallery } from "../templates/LazyTemplateGallery";
import { IconsSection } from "../icons/IconsSection";
import { GraphicsElements } from "../graphics/GraphicsElements";

const LayersTab = lazy(() => import("./LayersTab").then((module) => ({ default: module.LayersTab })));
const DataTab = lazy(() => import("../merge/DataTab").then((module) => ({ default: module.DataTab })));

type Tab = "templates" | "text" | "shapes" | "icons" | "graphics" | "ornaments" | "media" | "data" | "layers" | "page";
const TABS: Tab[] = ["templates", "text", "shapes", "icons", "graphics", "ornaments", "media", "data", "layers", "page"];
const TAB_ICONS: Record<Tab, LucideIcon> = {
  templates: LayoutTemplate,
  text: Type,
  shapes: Shapes,
  icons: Smile,
  graphics: ChartColumn,
  ornaments: Flower2,
  media: ImageIcon,
  data: Table2,
  layers: Layers,
  page: File,
};

const ORNAMENT_CATEGORIES: OrnamentCategory[] = ["frames", "seals", "dividers", "accents", "patterns"];
const previews = new Map<string, ReturnType<Ornament["build"]>>();

function ornamentPreview(item: Ornament) {
  let art = previews.get(item.id);
  if (!art) {
    art = item.build(DEFAULT_COLOURS, item.size);
    previews.set(item.id, art);
  }
  return art;
}

const OrnamentPreview = memo(function OrnamentPreview({ item }: { item: Ornament }) {
  const art = ornamentPreview(item);
  const wide = art.viewWidth >= art.viewHeight;
  return (
    <span className="block" style={{ width: wide ? "100%" : `${(art.viewWidth / art.viewHeight) * 100}%`, aspectRatio: `${art.viewWidth} / ${art.viewHeight}` }}>
      <PathsSvg paths={art.paths.map((path) => ({ d: path.d, fill: renderFill(path.fill, art.viewWidth, art.viewHeight), stroke: renderStroke(path.stroke), evenOdd: path.evenOdd, opacity: path.opacity }))} width={art.viewWidth} height={art.viewHeight} />
    </span>
  );
});

const ShapePreview = memo(function ShapePreview({ preset }: { preset: ShapePreset }) {
  const line = isLineShape(preset.shape);
  const element = presetShape(preset, 0, 0, 40, line ? 12 : 40, { fill: { type: "solid", color: "currentColor" } });
  const paths = shapePaths(line ? { ...element, stroke: { color: "currentColor", width: 3, dash: "solid" } } : element);
  return (
    <span className="block size-8 text-primary">
      <PathsSvg paths={paths} width={40} height={element.height} />
    </span>
  );
});

function livePage() {
  return currentPage(useStudioStore.getState());
}

function useHasPage(): boolean {
  return useStudioStore((state) => Boolean(currentPage(state)));
}

function TextTab() {
  const { t } = useTranslation();
  if (!useHasPage()) return null;
  const addText = (preset: TextPreset) => {
    const page = livePage();
    if (page) insertText(page, preset, t(`studio.elements.${preset.key}Text`));
  };
  return (
    <div className="space-y-2 p-4">
      {TEXT_PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => addText(preset)}
          className={cn("card glass-tinted block w-full rounded-lg px-3 py-2 text-left hover:ring-2 hover:ring-primary/40", preset.key === "heading" ? "text-xl font-bold" : preset.key === "subheading" ? "text-base font-semibold" : "text-sm")}
        >
          {t(`studio.elements.${preset.key}`)}
        </button>
      ))}
    </div>
  );
}

function ShapesTab() {
  const { t } = useTranslation();
  if (!useHasPage()) return null;
  const addShape = (preset: ShapePreset) => {
    const page = livePage();
    if (page) insertShape(page, preset);
  };
  return (
    <div className="grid grid-cols-4 gap-2 p-4">
      {SHAPE_PRESETS.map((preset) => (
        <button key={preset.key} type="button" data-shape-preset={preset.key} onClick={() => addShape(preset)} aria-label={t(`studio.shapes.${preset.key}`)} title={t(`studio.shapes.${preset.key}`)} className="card glass-tinted flex aspect-square items-center justify-center rounded-lg hover:ring-2 hover:ring-primary/40">
          <ShapePreview preset={preset} />
        </button>
      ))}
    </div>
  );
}

function IconsTab() {
  if (!useHasPage()) return null;
  return (
    <div className="p-4">
      <IconsSection />
    </div>
  );
}

function GraphicsTab() {
  if (!useHasPage()) return null;
  return (
    <div className="p-4">
      <GraphicsElements />
    </div>
  );
}

function OrnamentsTab() {
  const { t } = useTranslation();
  if (!useHasPage()) return null;
  const addOrnament = (item: Ornament) => {
    const page = livePage();
    if (!page) return;
    const colours = paletteColours(useStudioStore.getState().design?.palette);
    const name = t(`studio.ornaments.items.${item.id}`);
    if (item.fitsPage) {
      insert(createVector(item.build(colours, { width: page.width, height: page.height }), 0, 0, page.width, page.height, name), false);
      return;
    }
    const scale = (Math.min(page.width, page.height) * 0.4) / Math.max(item.size.width, item.size.height);
    const width = item.size.width * scale;
    const height = item.size.height * scale;
    const at = centred(page, width, height);
    insert(createVector(item.build(colours, item.size), at.x, at.y, width, height, name));
  };
  return (
    <div className="space-y-3 p-4">
      {ORNAMENT_CATEGORIES.map((category) => (
        <div key={category} className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t(`studio.ornaments.categories.${category}`)}</p>
          <div className="grid grid-cols-3 gap-2">
            {ORNAMENTS.filter((item) => item.category === category).map((item) => (
              <button
                key={item.id}
                type="button"
                data-ornament={item.id}
                onClick={() => addOrnament(item)}
                aria-label={t(`studio.ornaments.items.${item.id}`)}
                title={t(`studio.ornaments.items.${item.id}`)}
                className="card glass-tinted paper-surface flex aspect-square items-center justify-center rounded-lg bg-white p-1.5 hover:ring-2 hover:ring-primary/40"
              >
                <OrnamentPreview item={item} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MediaTab() {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  if (!useHasPage()) return null;

  const addImage = async () => {
    const src = await pickImage(t("studio.elements.image"), { drawings: true });
    const page = livePage();
    if (!src || !page) return;
    if (src.toLowerCase().endsWith(".svg")) {
      try {
        const drawing = await studioImportSvg({ path: src });
        const ratio = drawing.width / drawing.height || 1;
        const width = Math.min(page.width * 0.5, ratio >= 1 ? page.width * 0.5 : page.height * 0.5 * ratio);
        const at = centred(page, width, width / ratio);
        insert(createSvg(drawing.svg, at.x, at.y, width, width / ratio));
      } catch (error) {
        toast("error", describeError(t, toRpcError(error)));
      }
      return;
    }
    const preview = await loadImagePreview(src);
    const ratio = preview ? preview.width / preview.height : 4 / 3;
    const width = Math.min(page.width * 0.5, ratio >= 1 ? page.width * 0.5 : page.height * 0.5 * ratio);
    const height = width / ratio;
    const at = centred(page, width, height);
    insert(createImage(src, at.x, at.y, width, height));
  };

  const addQr = () => {
    const page = livePage();
    if (!page) return;
    const side = Math.min(page.width, page.height) * 0.2;
    const at = centred(page, side, side);
    insert(createQr("https://", at.x, at.y, side));
  };

  return (
    <div className="grid grid-cols-2 gap-2 p-4">
      <button type="button" onClick={() => void addImage()} className="card glass-tinted flex flex-col items-center gap-1.5 rounded-lg p-3 text-sm hover:ring-2 hover:ring-primary/40">
        <ImageIcon className="size-5 text-primary" aria-hidden />
        {t("studio.elements.image")}
      </button>
      <button type="button" onClick={addQr} className="card glass-tinted flex flex-col items-center gap-1.5 rounded-lg p-3 text-sm hover:ring-2 hover:ring-primary/40">
        <QrCode className="size-5 text-primary" aria-hidden />
        {t("studio.elements.qr")}
      </button>
    </div>
  );
}

function PageTab() {
  const page = useStudioStore((state) => currentPage(state));
  if (!page) return null;
  return (
    <>
      <PageProperties page={page} />
      <DesignColours />
    </>
  );
}

const BODIES: Record<Exclude<Tab, "templates" | "data" | "layers">, () => ReactNode> = {
  text: TextTab,
  shapes: ShapesTab,
  icons: IconsTab,
  graphics: GraphicsTab,
  ornaments: OrnamentsTab,
  media: MediaTab,
  page: PageTab,
};

function TabSkeleton() {
  return (
    <div aria-busy className="flex animate-pulse flex-col gap-2 p-3">
      <div className="h-4 w-full rounded bg-muted" />
      <div className="h-4 w-4/5 rounded bg-muted" />
      <div className="h-4 w-3/5 rounded bg-muted" />
    </div>
  );
}

function TemplatesTab() {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.locale);
  const page = useStudioStore(useShallow((state) => {
    const current = currentPage(state);
    return current ? { width: current.width, height: current.height } : null;
  }));
  const pick = (template: StudioTemplate) => {
    const store = useStudioStore.getState();
    if (!store.design) return;
    const result = insertTemplate(store.design, store.pageId, buildTemplate(template, t, language));
    if (!result) {
      useToastStore.getState().push("error", t("studio.templates.tooManyPages"));
      return;
    }
    store.apply(() => result.design);
    store.select([]);
    store.setPage(result.pageId);
  };
  return <LazyTemplateGallery language={language} box={104} onPick={pick} className="p-3" page={page} />;
}

function TabBody({ tab }: { tab: Tab }) {
  if (tab === "templates") return <TemplatesTab />;
  if (tab === "data") return <DataTab />;
  if (tab === "layers") return <LayersTab />;
  const Body = BODIES[tab];
  return <Body />;
}

export function ElementsPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("text");
  const open = useSidePanelsStore((state) => state.panelOpen);
  const setOpen = useSidePanelsStore((state) => state.setPanelOpen);
  const choose = (next: Tab) => {
    setTab(next);
    if (!open) setOpen(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(tab);
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length];
    choose(target);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-studio-tab="${target}"]`)?.focus();
  };
  const label = t(`studio.panel.${tab}`);
  return (
    <aside aria-label={t("studio.panel.label")} className="flex shrink-0 border-r border-border/60">
      <div role="tablist" aria-orientation="vertical" aria-label={t("studio.panel.label")} className="glass-flat flex w-20 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-e border-border/60 py-2" onKeyDown={onKeyDown}>
        {TABS.map((item) => {
          const Icon = TAB_ICONS[item];
          const name = t(`studio.panel.${item}`);
          const selected = tab === item;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              id={`studio-panel-tab-${item}`}
              aria-selected={selected}
              aria-controls={open ? "studio-panel-body" : undefined}
              tabIndex={selected ? 0 : -1}
              title={name}
              data-studio-tab={item}
              onClick={() => choose(item)}
              className={cn(
                "flex w-18 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-2xs leading-tight outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
                selected && open ? "menubar-active text-foreground" : "text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground",
              )}
            >
              <Icon className={cn("size-5 shrink-0", selected && open && "text-primary")} aria-hidden />
              <span className="w-full hyphens-auto break-words text-center">{name}</span>
            </button>
          );
        })}
      </div>
      {open ? (
        <div className="glass flex w-72 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 ps-4 pe-2">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</h2>
            <IconButton icon={PanelLeftClose} label={t("studio.panel.hide")} onClick={() => setOpen(false)} />
          </div>
          <div key={tab} id="studio-panel-body" role="tabpanel" aria-labelledby={`studio-panel-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<TabSkeleton />}>
              <TabBody tab={tab} />
            </Suspense>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

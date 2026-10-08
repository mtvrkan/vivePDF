import { memo, useState } from "react";
import { Image as ImageIcon, Layers, LayoutTemplate, QrCode, Shapes, Table2, Type, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { LayersTab } from "./LayersTab";
import { insertTemplate } from "../templates/apply";
import { buildTemplate } from "../templates/catalog";
import type { StudioTemplate } from "../templates/kit";
import { TemplateGallery } from "../templates/TemplateGallery";
import { DataTab } from "../merge/DataTab";
import { IconsSection } from "../icons/IconsSection";
import { GraphicsElements } from "../graphics/GraphicsElements";

type Tab = "templates" | "elements" | "layers" | "data";
const TABS: Tab[] = ["templates", "elements", "data", "layers"];
const TAB_ICONS: Record<Tab, LucideIcon> = { templates: LayoutTemplate, elements: Shapes, data: Table2, layers: Layers };


const ORNAMENT_CATEGORIES: OrnamentCategory[] = ["frames", "seals", "dividers", "accents"];
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

function ElementsTab() {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const hasPage = useStudioStore((state) => Boolean(currentPage(state)));
  if (!hasPage) return null;
  const livePage = () => currentPage(useStudioStore.getState());

  const addText = (preset: TextPreset) => {
    const page = livePage();
    if (page) insertText(page, preset, t(`studio.elements.${preset.key}Text`));
  };

  const addShape = (preset: ShapePreset) => {
    const page = livePage();
    if (page) insertShape(page, preset);
  };

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

  const addQr = () => {
    const page = livePage();
    if (!page) return;
    const side = Math.min(page.width, page.height) * 0.2;
    const at = centred(page, side, side);
    insert(createQr("https://", at.x, at.y, side));
  };

  return (
    <div className="space-y-5 p-4">
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Type className="size-3.5" aria-hidden />
          {t("studio.elements.text")}
        </h3>
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
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.elements.shapes")}</h3>
        <div className="grid grid-cols-4 gap-2">
          {SHAPE_PRESETS.map((preset) => (
            <button key={preset.key} type="button" data-shape-preset={preset.key} onClick={() => addShape(preset)} aria-label={t(`studio.shapes.${preset.key}`)} title={t(`studio.shapes.${preset.key}`)} className="card glass-tinted flex aspect-square items-center justify-center rounded-lg hover:ring-2 hover:ring-primary/40">
              <ShapePreview preset={preset} />
            </button>
          ))}
        </div>
      </section>
      <IconsSection />
      <GraphicsElements />
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.elements.ornaments")}</h3>
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
      </section>
      <section className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void addImage()} className="card glass-tinted flex flex-col items-center gap-1.5 rounded-lg p-3 text-sm hover:ring-2 hover:ring-primary/40">
          <ImageIcon className="size-5 text-primary" aria-hidden />
          {t("studio.elements.image")}
        </button>
        <button type="button" onClick={addQr} className="card glass-tinted flex flex-col items-center gap-1.5 rounded-lg p-3 text-sm hover:ring-2 hover:ring-primary/40">
          <QrCode className="size-5 text-primary" aria-hidden />
          {t("studio.elements.qr")}
        </button>
      </section>
    </div>
  );
}

function TemplatesTab() {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.locale);
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
  return <TemplateGallery language={language} box={104} onPick={pick} className="p-3" />;
}

export function ElementsPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("elements");
  const body = tab === "templates" ? <TemplatesTab /> : tab === "elements" ? <ElementsTab /> : tab === "data" ? <DataTab /> : <LayersTab />;
  return (
    <aside aria-label={t("studio.panel.label")} className="glass flex w-72 shrink-0 flex-col border-r border-border/60">
      <div role="tablist" aria-label={t("studio.panel.label")} className="grid grid-cols-4 gap-1 border-b border-border/60 p-2">
        {TABS.map((item) => {
          const Icon = TAB_ICONS[item];
          const label = t(`studio.panel.${item}`);
          return (
            <button
              key={item}
              type="button"
              role="tab"
              id={`studio-panel-tab-${item}`}
              aria-selected={tab === item}
              aria-controls="studio-panel-body"
              title={label}
              data-studio-tab={item}
              onClick={() => setTab(item)}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] leading-tight outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
                tab === item ? "menubar-active font-medium text-foreground" : "text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", tab === item && "text-primary")} aria-hidden />
              <span className="w-full truncate text-center">{label}</span>
            </button>
          );
        })}
      </div>
      <div key={tab} id="studio-panel-body" role="tabpanel" aria-labelledby={`studio-panel-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {body}
      </div>
    </aside>
  );
}

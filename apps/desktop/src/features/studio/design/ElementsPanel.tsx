import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Image as ImageIcon, Layers, LayoutTemplate, Lock, LockOpen, QrCode, Shapes, Table2, Type, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { studioImportSvg } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { STUDIO_SHAPES, type StudioElement, type StudioPage, type StudioShapeKind } from "@/types/studio";
import { createImage, createQr, createShape, createSvg, createText, createVector } from "../model/design";
import { DEFAULT_COLOURS, ORNAMENTS, paletteColours, type Ornament, type OrnamentCategory } from "../ornaments/ornaments";
import { addElements, reorderElements, updateElement } from "../model/edit";
import { loadImagePreview } from "./assets";
import { toggleHidden } from "./commands";
import { elementLabel } from "./labels";
import { PathsSvg } from "./ElementView";
import { pickImage } from "./pickImage";
import { renderFill, renderStroke, shapePaths } from "../model/shapes";
import { currentPage, useStudioStore } from "./studioStore";
import { insertTemplate } from "../templates/apply";
import { buildTemplate } from "../templates/catalog";
import type { StudioTemplate } from "../templates/kit";
import { TemplateGallery } from "../templates/TemplateGallery";
import { DataTab } from "../merge/DataTab";

type Tab = "templates" | "elements" | "layers" | "data";
const TABS: Tab[] = ["templates", "elements", "data", "layers"];
const TAB_ICONS: Record<Tab, LucideIcon> = { templates: LayoutTemplate, elements: Shapes, data: Table2, layers: Layers };
const TEXT_PRESETS = [
  { key: "heading", fontSize: 44, bold: true },
  { key: "subheading", fontSize: 26, bold: true },
  { key: "body", fontSize: 14, bold: false },
] as const;

const CASCADE = 16;
const MAX_CASCADE = 20;

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

function OrnamentPreview({ item }: { item: Ornament }) {
  const art = ornamentPreview(item);
  const wide = art.viewWidth >= art.viewHeight;
  return (
    <span className="block" style={{ width: wide ? "100%" : `${(art.viewWidth / art.viewHeight) * 100}%`, aspectRatio: `${art.viewWidth} / ${art.viewHeight}` }}>
      <PathsSvg paths={art.paths.map((path) => ({ d: path.d, fill: renderFill(path.fill, art.viewWidth, art.viewHeight), stroke: renderStroke(path.stroke), evenOdd: path.evenOdd, opacity: path.opacity }))} width={art.viewWidth} height={art.viewHeight} />
    </span>
  );
}

function insert(element: StudioElement, cascade = true) {
  const store = useStudioStore.getState();
  store.applyToPage((page) => {
    let placed = element;
    for (let step = 0; cascade && step < MAX_CASCADE && page.elements.some((other) => Math.abs(other.x - placed.x) < 1 && Math.abs(other.y - placed.y) < 1); step += 1) {
      placed = { ...placed, x: placed.x + CASCADE, y: placed.y + CASCADE };
    }
    return addElements(page, [placed]);
  });
  store.select([element.id]);
}

function centred(page: StudioPage, width: number, height: number) {
  return { x: (page.width - width) / 2, y: (page.height - height) / 2 };
}

function ShapePreview({ shape }: { shape: StudioShapeKind }) {
  const element = createShape(shape, 0, 0, 40, shape === "line" || shape === "arrowLine" ? 12 : 40, { fill: { type: "solid", color: "currentColor" } });
  const paths = shapePaths(shape === "line" || shape === "arrowLine" ? { ...element, stroke: { color: "currentColor", width: 3, dash: "solid" } } : element);
  return (
    <span className="block size-8 text-primary">
      <PathsSvg paths={paths} width={40} height={element.height} />
    </span>
  );
}

function ElementsTab() {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const page = useStudioStore((state) => currentPage(state));
  if (!page) return null;

  const addText = (preset: (typeof TEXT_PRESETS)[number]) => {
    const width = Math.min(page.width * 0.7, preset.fontSize * 14);
    const height = Math.ceil(preset.fontSize * 1.3);
    const at = centred(page, width, height);
    insert(createText(at.x, at.y, width, height, t(`studio.elements.${preset.key}Text`), { fontSize: preset.fontSize, bold: preset.bold, align: "center" }));
  };

  const addShape = (shape: StudioShapeKind) => {
    const side = Math.min(page.width, page.height) * 0.25;
    const height = shape === "line" || shape === "arrowLine" ? 16 : side;
    const at = centred(page, side, height);
    insert(createShape(shape, at.x, at.y, side, height));
  };

  const addImage = async () => {
    const src = await pickImage(t("studio.elements.image"), { drawings: true });
    if (!src) return;
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
          {STUDIO_SHAPES.map((shape) => (
            <button key={shape} type="button" onClick={() => addShape(shape)} aria-label={t(`studio.shapes.${shape}`)} title={t(`studio.shapes.${shape}`)} className="card glass-tinted flex aspect-square items-center justify-center rounded-lg hover:ring-2 hover:ring-primary/40">
              <ShapePreview shape={shape} />
            </button>
          ))}
        </div>
      </section>
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

function LayersTab() {
  const { t } = useTranslation();
  const page = useStudioStore((state) => currentPage(state));
  const selection = useStudioStore((state) => state.selection);
  const select = useStudioStore((state) => state.select);
  const applyToPage = useStudioStore((state) => state.applyToPage);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!page) return null;
  if (!page.elements.length) return <p className="p-4 text-sm text-muted-foreground">{t("studio.layers.empty")}</p>;
  const ordered = [...page.elements].reverse();
  return (
    <ul className="space-y-1 p-2" aria-label={t("studio.layers.label")}>
      {ordered.map((element, index) => {
        const active = selection.includes(element.id);
        const label = elementLabel(element, t);
        return (
          <li key={element.id} className={cn("flex items-center gap-1 rounded-lg pl-2", active ? "glass-chip" : "hover:bg-muted/50")}>
            {renaming === element.id ? (
              <input
                autoFocus
                defaultValue={element.name}
                aria-label={t("studio.layers.rename")}
                className="field h-7 min-w-0 flex-1 rounded px-2 text-sm"
                onBlur={(event) => {
                  const name = event.target.value.trim().slice(0, 200);
                  applyToPage((current) => updateElement(current, element.id, { name }));
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setRenaming(null);
                  event.stopPropagation();
                }}
              />
            ) : (
              <button
                type="button"
                aria-pressed={active}
                onClick={(event) => select(event.shiftKey ? (active ? selection.filter((id) => id !== element.id) : [...selection, element.id]) : [element.id])}
                onDoubleClick={() => setRenaming(element.id)}
                className={cn("min-w-0 flex-1 truncate py-1.5 text-left text-sm", element.hidden && "text-muted-foreground line-through")}
              >
                {label}
              </button>
            )}
            <IconButton icon={ArrowUp} label={t("studio.layers.forward", { name: label })} disabled={index === 0} onClick={() => applyToPage((current) => reorderElements(current, [element.id], "forward"))} />
            <IconButton icon={ArrowDown} label={t("studio.layers.backward", { name: label })} disabled={index === ordered.length - 1} onClick={() => applyToPage((current) => reorderElements(current, [element.id], "backward"))} />
            <IconButton icon={element.hidden ? EyeOff : Eye} label={element.hidden ? t("studio.layers.show", { name: label }) : t("studio.layers.hide", { name: label })} onClick={() => toggleHidden(element.id)} />
            <IconButton
              icon={element.locked ? Lock : LockOpen}
              active={element.locked}
              label={element.locked ? t("studio.layers.unlock", { name: label }) : t("studio.layers.lock", { name: label })}
              onClick={() => applyToPage((current) => updateElement(current, element.id, { locked: !element.locked }))}
            />
          </li>
        );
      })}
    </ul>
  );
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
      <div id="studio-panel-body" role="tabpanel" aria-labelledby={`studio-panel-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {body}
      </div>
    </aside>
  );
}

import { memo, useCallback, useMemo, useRef } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LOCALES } from "@/app/locales";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Field, Segmented, SelectInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import type { Locale } from "@/types";
import type { StudioDesign } from "@/types/studio";
import { PageView } from "../design/ElementView";
import { STUDIO_PAGE_SIZES } from "../model/design";
import { useTemplateThumbnail } from "../templates/thumbnails";
import { specOf } from "./cvDesigns";
import { CV_DENSITIES, CV_LAYOUT_IDS, CV_PAPERS, CV_PHOTO_SHAPES, CV_SKILL_STYLES, sampleProfile, type CvLayoutId, type CvProfile, type CvTheme } from "./cvModel";
import { sampleCv } from "./cvSample";
import { useCvStore } from "./cvStore";

const THUMB_WIDTH = 132;
const ACCENTS = ["#38bdf8", "#2563eb", "#1f3a5f", "#0f766e", "#16a34a", "#ca8a04", "#ea580c", "#e11d48", "#9333ea", "#111827"];
const THUMBNAIL_CACHE_LIMIT = 80;
const thumbnails = new Map<string, StudioDesign>();

function thumbnailKey(layout: CvLayoutId, theme: CvTheme): string {
  return [layout, theme.accent, theme.headingFont, theme.bodyFont, theme.photoShape, theme.skillStyle, theme.paper, theme.density, theme.language].join("|");
}

function thumbnailOf(layout: CvLayoutId, theme: CvTheme, profile: CvProfile, t: (key: string) => string): StudioDesign {
  const key = thumbnailKey(layout, theme);
  let design = thumbnails.get(key);
  if (!design) {
    design = sampleCv(profile, { ...theme, layout }, t, "");
    if (thumbnails.size >= THUMBNAIL_CACHE_LIMIT) thumbnails.clear();
    thumbnails.set(key, design);
  }
  return design;
}

const LayoutCard = memo(function LayoutCard({ layout, theme, profile, active, onPick }: { layout: CvLayoutId; theme: CvTheme; profile: CvProfile; active: boolean; onPick: (layout: CvLayoutId) => void }) {
  const { t } = useTranslation();
  const paper = STUDIO_PAGE_SIZES[theme.paper];
  const scale = THUMB_WIDTH / paper.width;
  const height = paper.height * scale;
  const name = t(`studio.cv.layouts.${layout}`);
  const pageOf = useCallback(() => thumbnailOf(layout, theme, profile, t).pages[0], [layout, theme, profile, t]);
  const thumbnail = useTemplateThumbnail(`cv:${thumbnailKey(layout, theme)}`, pageOf, theme.language, Math.ceil(height));
  const shown = useRef<string | null>(null);
  if (thumbnail.status === "ready") shown.current = thumbnail.url;
  const fallback = thumbnail.status === "error" ? pageOf() : null;
  return (
    <button
      type="button"
      onClick={() => onPick(layout)}
      aria-pressed={active}
      data-cv-layout={layout}
      title={name}
      className={cn("card flex flex-col items-center gap-2 rounded-xl p-2.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/40")}
    >
      <span className="paper-surface relative block overflow-hidden rounded-sm border border-border bg-white shadow-sm" style={{ width: `${THUMB_WIDTH}px`, height: `${height}px` }} aria-hidden>
        {fallback ? (
          <span className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
            <PageView page={fallback} language={theme.language} />
          </span>
        ) : shown.current ? (
          <img src={shown.current} alt="" draggable={false} decoding="async" data-thumbnail-state={thumbnail.status} className="block size-full" />
        ) : (
          <span data-thumbnail-state="loading" className="block size-full animate-pulse bg-muted" />
        )}
      </span>
      <span className="w-full truncate text-xs font-medium">{name}</span>
    </button>
  );
});

function SectionOrder() {
  const { t } = useTranslation();
  const order = useCvStore((state) => state.profile.order);
  const hidden = useCvStore((state) => state.profile.hidden);
  const update = useCvStore((state) => state.updateProfile);
  const move = (index: number, step: -1 | 1) =>
    update((profile) => {
      const next = [...profile.order];
      const target = index + step;
      if (target < 0 || target >= next.length) return profile;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...profile, order: next };
    });
  const toggle = (key: CvProfile["order"][number]) => update((profile) => ({ ...profile, hidden: profile.hidden.includes(key) ? profile.hidden.filter((item) => item !== key) : [...profile.hidden, key] }));
  return (
    <ol className="space-y-1">
      {order.map((key, index) => {
        const name = t(`studio.cv.sections.${key}`);
        const off = hidden.includes(key);
        return (
          <li key={key} className="flex items-center gap-1 rounded-lg border border-border/60 py-0.5 ps-3 pe-1">
            <span className={cn("min-w-0 flex-1 truncate text-sm", off && "text-muted-foreground line-through")}>{name}</span>
            <IconButton icon={off ? EyeOff : Eye} label={off ? t("studio.cv.showSection", { name }) : t("studio.cv.hideSection", { name })} onClick={() => toggle(key)} />
            <IconButton icon={ArrowUp} label={t("studio.cv.moveUp", { name })} disabled={index === 0} onClick={() => move(index, -1)} />
            <IconButton icon={ArrowDown} label={t("studio.cv.moveDown", { name })} disabled={index === order.length - 1} onClick={() => move(index, 1)} />
          </li>
        );
      })}
    </ol>
  );
}

export function CvDesignPanel() {
  const { t } = useTranslation();
  const theme = useCvStore((state) => state.theme);
  const updateTheme = useCvStore((state) => state.updateTheme);
  const sample = useMemo(() => sampleProfile(t), [t]);
  const spec = specOf(theme.layout);
  const accent = theme.accent ?? spec.accent;
  const pickLayout = useCallback((layout: CvLayoutId) => updateTheme({ layout }), [updateTheme]);

  return (
    <div className="space-y-5">
      <section className="space-y-2.5" aria-labelledby="cv-layouts">
        <h3 id="cv-layouts" className="text-sm font-semibold">
          {t("studio.cv.design.layout")}
        </h3>
        <div className="grid grid-cols-2 gap-2.5">
          {CV_LAYOUT_IDS.map((layout) => (
            <LayoutCard key={layout} layout={layout} theme={theme} profile={sample} active={theme.layout === layout} onPick={pickLayout} />
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex items-end gap-2">
          <ColorSwatch label={t("studio.cv.design.accent")} value={accent} customLabel={t("colorPicker.custom")} presets={ACCENTS} onChange={(value) => updateTheme({ accent: value.toLowerCase() })} />
          {theme.accent ? <IconButton icon={RotateCcw} label={t("studio.cv.design.resetAccent")} onClick={() => updateTheme({ accent: null })} /> : null}
        </div>
        <Field label={t("studio.cv.design.headingFont")}>
          <FontPicker value={theme.headingFont ?? spec.fonts.heading} onChange={(value) => updateTheme({ headingFont: value })} />
        </Field>
        <Field label={t("studio.cv.design.bodyFont")}>
          <FontPicker value={theme.bodyFont ?? spec.fonts.body} onChange={(value) => updateTheme({ bodyFont: value })} />
        </Field>
        {theme.headingFont || theme.bodyFont ? (
          <button type="button" onClick={() => updateTheme({ headingFont: null, bodyFont: null })} className="text-xs font-medium text-primary hover:underline">
            {t("studio.cv.design.resetFonts")}
          </button>
        ) : null}
        <Field label={t("studio.cv.design.photo")}>
          <Segmented size="sm" value={theme.photoShape} options={CV_PHOTO_SHAPES} labelOf={(value) => t(`studio.cv.photoShapes.${value}`)} onChange={(photoShape) => updateTheme({ photoShape })} ariaLabel={t("studio.cv.design.photo")} />
        </Field>
        {!spec.photo ? <p className="text-xs text-muted-foreground">{t("studio.cv.design.noPhotoLayout")}</p> : null}
        <Field label={t("studio.cv.design.skills")}>
          <Segmented size="sm" value={theme.skillStyle} options={CV_SKILL_STYLES} labelOf={(value) => t(`studio.cv.skillStyles.${value}`)} onChange={(skillStyle) => updateTheme({ skillStyle })} ariaLabel={t("studio.cv.design.skills")} />
        </Field>
        <Field label={t("studio.cv.design.density")}>
          <Segmented size="sm" value={theme.density} options={CV_DENSITIES} labelOf={(value) => t(`studio.cv.densities.${value}`)} onChange={(density) => updateTheme({ density })} ariaLabel={t("studio.cv.design.density")} />
        </Field>
        <Field label={t("studio.cv.design.paper")}>
          <Segmented size="sm" value={theme.paper} options={CV_PAPERS} labelOf={(value) => t(`studio.cv.papers.${value}`)} onChange={(paper) => updateTheme({ paper })} ariaLabel={t("studio.cv.design.paper")} />
        </Field>
        <Field label={t("studio.cv.design.language")} hint={t("studio.cv.design.languageHint")}>
          <SelectInput value={theme.language} onChange={(event) => updateTheme({ language: event.target.value as Locale })}>
            {LOCALES.map((locale) => (
              <option key={locale.code} value={locale.code}>
                {locale.nativeName}
              </option>
            ))}
          </SelectInput>
        </Field>
      </section>
      <section className="space-y-2.5" aria-labelledby="cv-order">
        <h3 id="cv-order" className="text-sm font-semibold">
          {t("studio.cv.design.order")}
        </h3>
        <SectionOrder />
      </section>
    </div>
  );
}

import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SliderField } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import type { StudioImageElement, StudioImageFilters } from "@/types/studio";
import { FILTER_KEYS, FILTER_PRESET_NAMES, FILTER_PRESETS, FILTER_RANGES, isNeutral, NEUTRAL_FILTERS, presetOf, type FilterPreset } from "../model/imageFilters";
import { useImagePreview } from "./assets";
import { patchSelected } from "./commands";
import { PanelSection } from "./controls";
import { useImageFilter } from "./imageFilter";

function setFilters(next: StudioImageFilters, merge?: string) {
  patchSelected((item) => (item.kind === "image" ? { filters: isNeutral(next) ? undefined : next } : {}), merge);
}

function PresetChip({ name, url, active, onPick }: { name: FilterPreset; url: string | null; active: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  const filter = useImageFilter(FILTER_PRESETS[name]);
  return (
    <button
      type="button"
      aria-pressed={active}
      data-filter-preset={name}
      onClick={onPick}
      className={cn("flex flex-col items-center gap-1 rounded-lg p-1 text-xs text-foreground/80 hover:text-foreground", active ? "glass-chip text-primary" : "nav-glass")}
    >
      <span aria-hidden className="relative block size-10 overflow-hidden rounded-md bg-muted">
        {url ? <img src={url} alt="" draggable={false} className="size-full object-cover" style={{ filter: filter.css }} /> : null}
        {filter.defs}
      </span>
      {t(`studio.filters.presets.${name}`)}
    </button>
  );
}

export function ImageFiltersSection({ element }: { element: StudioImageElement }) {
  const { t } = useTranslation();
  const preview = useImagePreview(element.src || null);
  const url = preview?.status === "ready" ? preview.value.url : null;
  const filters = element.filters ?? NEUTRAL_FILTERS;
  const preset = presetOf(element.filters);
  const percent = (value: number) => `${Math.round(value)}%`;
  return (
    <PanelSection title={t("studio.filters.title")}>
      <div role="group" aria-label={t("studio.filters.presetsLabel")} className="grid grid-cols-3 gap-1">
        {FILTER_PRESET_NAMES.map((name) => (
          <PresetChip key={name} name={name} url={url} active={preset === name} onPick={() => setFilters(FILTER_PRESETS[name])} />
        ))}
      </div>
      {FILTER_KEYS.map((key) => {
        const [min, max] = FILTER_RANGES[key];
        const neutral = NEUTRAL_FILTERS[key];
        const value = Math.round((filters[key] - neutral) * 100);
        return (
          <SliderField
            key={key}
            label={t(`studio.filters.${key}`)}
            value={value}
            min={Math.round((min - neutral) * 100)}
            max={Math.round((max - neutral) * 100)}
            format={(shown) => (shown > 0 && min < neutral ? `+${percent(shown)}` : percent(shown))}
            onChange={(next) => setFilters({ ...filters, [key]: neutral + next / 100 }, `filter-${key}`)}
          />
        );
      })}
      <button type="button" disabled={isNeutral(element.filters)} onClick={() => setFilters(NEUTRAL_FILTERS)} className="glass-chip inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40">
        <RotateCcw className="size-4" aria-hidden />
        {t("studio.filters.reset")}
      </button>
    </PanelSection>
  );
}

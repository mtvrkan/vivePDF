import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ColorSwatch, type ColorSwatchRow } from "@/components/shared/ColorSwatch";
import { Select, type SelectOption } from "@/components/shared/Select";
import { Segmented, SliderField } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { STUDIO_DASHES, STUDIO_LINE_CAPS, STUDIO_LINE_JOINS, type StudioFill, type StudioGradientStop, type StudioLineCap, type StudioLineJoin, type StudioStroke } from "@/types/studio";
import { designColors } from "../model/colors";
import { MAX_DASH_GAP, MIN_DASH_GAP } from "../model/design";
import { strokeCap, strokeJoin } from "../model/shapes";
import { GradientEditor } from "./GradientEditor";
import { useRecentColors } from "./recentColors";
import { useStudioStore } from "./studioStore";

const MAX_DOCUMENT_COLOURS = 12;
const DEFAULT_STROKE: StudioStroke = { color: "#1f2937", width: 2, dash: "solid" };

export function PanelSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 border-b border-border/60 px-4 py-4 last:border-b-0", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

type NumberInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  mixed?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
};

export function NumberInput({ value, onChange, min = -100000, max = 100000, step = 1, suffix, disabled, mixed = false, id, ariaLabel, className }: NumberInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(mixed ? "" : String(value));
  useEffect(() => setDraft(mixed ? "" : String(value)), [value, mixed]);
  const commit = () => {
    if (mixed && !draft.trim()) return;
    const parsed = Number(draft.replace(",", "."));
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(mixed ? "" : String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    if (mixed || clamped !== value) onChange(clamped);
    setDraft(String(clamped));
  };
  return (
    <span className={cn("field flex h-8 items-center rounded-lg pr-2", className)}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={mixed ? t("studio.props.mixed") : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !mixed) {
            event.preventDefault();
            const delta = (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
            const next = Math.min(max, Math.max(min, Math.round((value + delta) * 1000) / 1000));
            onChange(next);
          }
        }}
        className="min-w-0 flex-1 bg-transparent px-2 text-sm tabular-nums outline-none placeholder:text-muted-foreground"
      />
      {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
    </span>
  );
}

export function NumberField({ label, ...props }: Omit<NumberInputProps, "id" | "ariaLabel" | "className"> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <NumberInput id={id} {...props} />
    </label>
  );
}

export function OpacityField({ label, value, onChange, mixed = false, disabled }: { label: string; value: number; onChange: (value: number, merge?: string) => void; mixed?: boolean; disabled?: boolean }) {
  const id = useId();
  const percent = Math.round(value * 100);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-foreground/80">
          {label}
        </label>
        <NumberInput id={id} className="w-20" value={percent} mixed={mixed} min={0} max={100} suffix="%" disabled={disabled} onChange={(next) => onChange(next / 100, "opacity")} />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={mixed ? 100 : percent}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={`${percent}%`}
        onChange={(event) => onChange(Number(event.target.value) / 100, "opacity")}
        className="w-full accent-primary disabled:opacity-50"
      />
    </div>
  );
}

function studioColorRows(t: TFunction): ColorSwatchRow[] {
  const design = useStudioStore.getState().design;
  return [
    { id: "document", label: t("studio.colors.document"), colors: design ? designColors(design).slice(0, MAX_DOCUMENT_COLOURS) : [] },
    { id: "recent", label: t("studio.colors.recent"), colors: useRecentColors.getState().colors },
  ];
}

export function StudioColorSwatch({ value, onChange, label, mixed }: { value: string; onChange: (value: string) => void; label: string; mixed?: boolean }) {
  const { t } = useTranslation();
  return (
    <ColorSwatch
      value={value}
      onChange={onChange}
      label={label}
      customLabel={t("colorPicker.custom")}
      presetsLabel={t("studio.colors.presets")}
      rows={() => studioColorRows(t)}
      onCommit={(color) => useRecentColors.getState().push(color)}
      mixed={mixed}
      mixedLabel={t("studio.props.mixed")}
    />
  );
}

export function ColorField({ label, value, onChange, mixed }: { label: string; value: string; onChange: (value: string) => void; mixed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground/80">{label}</span>
      <StudioColorSwatch value={value} onChange={onChange} label={label} mixed={mixed} />
    </div>
  );
}

export function MixedHint() {
  const { t } = useTranslation();
  return <p className="text-xs text-muted-foreground">{t("studio.props.mixedHint")}</p>;
}

function SelectField({ label, value, options, onChange, placeholder }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <Select size="sm" value={value} placeholder={placeholder} ariaLabel={label} options={options} onChange={onChange} />
    </div>
  );
}

const FILL_TYPES = ["none", "solid", "linear", "radial"] as const;

function stopsOf(fill: StudioFill): StudioGradientStop[] {
  if (fill.type === "linear" || fill.type === "radial") return fill.stops;
  const base = fill.type === "solid" ? fill.color : "#3b82f6";
  return [{ offset: 0, color: base }, { offset: 1, color: "#ffffff" }];
}

export function FillEditor({ value, onChange, allowNone = true, mixed = false }: { value: StudioFill; onChange: (fill: StudioFill, merge?: string) => void; allowNone?: boolean; mixed?: boolean }) {
  const { t } = useTranslation();
  const types = allowNone ? FILL_TYPES : FILL_TYPES.filter((type) => type !== "none");
  const change = (type: (typeof FILL_TYPES)[number]) => {
    if (type === value.type) {
      if (mixed) onChange(value);
      return;
    }
    if (type === "none") onChange({ type: "none" });
    else if (type === "solid") onChange({ type: "solid", color: value.type === "solid" ? value.color : stopsOf(value)[0].color });
    else if (type === "linear") onChange({ type: "linear", angle: 90, stops: stopsOf(value) });
    else onChange({ type: "radial", stops: stopsOf(value), cx: 0.5, cy: 0.5, radius: 1 });
  };
  return (
    <div className="space-y-3">
      <Segmented size="sm" value={value.type} options={types} labelOf={(type) => t(`studio.fill.${type}`)} onChange={change} ariaLabel={t("studio.fill.label")} />
      {mixed ? <MixedHint /> : null}
      {value.type === "solid" ? <ColorField label={t("studio.fill.color")} value={value.color} mixed={mixed} onChange={(color) => onChange({ type: "solid", color }, "fill-color")} /> : null}
      {value.type === "linear" || value.type === "radial" ? <GradientEditor value={value} onChange={onChange} /> : null}
    </div>
  );
}

export function StrokeEditor({ value, onChange, mixed, openPath = false }: { value: StudioStroke | null; onChange: (stroke: StudioStroke | null, merge?: string) => void; mixed?: ReadonlySet<string>; openPath?: boolean }) {
  const { t } = useTranslation();
  const differs = (key: string) => mixed?.has(key) ?? false;
  const mixedText = t("studio.props.mixed");
  return (
    <div className="space-y-3">
      <Segmented
        size="sm"
        value={value ? "on" : "off"}
        options={["off", "on"] as const}
        labelOf={(option) => t(`studio.stroke.${option}`)}
        onChange={(option) => onChange(option === "on" ? (value ?? DEFAULT_STROKE) : null)}
        ariaLabel={t("studio.stroke.label")}
      />
      {mixed?.size ? <MixedHint /> : null}
      {value ? (
        <>
          <ColorField label={t("studio.stroke.color")} value={value.color} mixed={differs("color")} onChange={(color) => onChange({ ...value, color }, "stroke-color")} />
          <SliderField
            label={t("studio.stroke.width")}
            value={value.width}
            min={0.5}
            max={40}
            step={0.5}
            format={(width) => (differs("width") ? mixedText : `${width} pt`)}
            onChange={(width) => onChange({ ...value, width }, "stroke-width")}
          />
          <SelectField
            label={t("studio.stroke.style")}
            value={differs("dash") ? "" : value.dash}
            placeholder={mixedText}
            options={STUDIO_DASHES.map((dash) => ({ value: dash, label: t(`studio.stroke.${dash}`) }))}
            onChange={(dash) => onChange({ ...value, dash: dash as StudioStroke["dash"] })}
          />
          {value.dash !== "solid" ? (
            <SliderField
              label={t("studio.stroke.gap")}
              value={Math.round((value.gap ?? 1) * 100)}
              min={MIN_DASH_GAP * 100}
              max={MAX_DASH_GAP * 100}
              step={25}
              format={(gap) => (differs("gap") ? mixedText : `${gap}%`)}
              onChange={(gap) => onChange({ ...value, gap: gap / 100 }, "stroke-gap")}
            />
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {openPath || value.dash !== "solid" ? (
              <SelectField
                label={t("studio.stroke.cap")}
                value={differs("cap") ? "" : strokeCap(value)}
                placeholder={mixedText}
                options={STUDIO_LINE_CAPS.map((cap) => ({ value: cap, label: t(`studio.stroke.caps.${cap}`) }))}
                onChange={(cap) => onChange({ ...value, cap: cap as StudioLineCap })}
              />
            ) : null}
            {openPath ? null : (
              <SelectField
                label={t("studio.stroke.join")}
                value={differs("join") ? "" : strokeJoin(value)}
                placeholder={mixedText}
                options={STUDIO_LINE_JOINS.map((join) => ({ value: join, label: t(`studio.stroke.joins.${join}`) }))}
                onChange={(join) => onChange({ ...value, join: join as StudioLineJoin })}
              />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

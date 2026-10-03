import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Segmented, SliderField } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import type { StudioFill, StudioGradientStop, StudioStroke } from "@/types/studio";

export function PanelSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 border-b border-border/60 px-4 py-4 last:border-b-0", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function NumberField({ label, value, onChange, min = -100000, max = 100000, step = 1, suffix, disabled }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    if (clamped !== value) onChange(clamped);
    setDraft(String(clamped));
  };
  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <span className="field flex h-8 items-center rounded-lg pr-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const delta = (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
              const next = Math.min(max, Math.max(min, Math.round((value + delta) * 1000) / 1000));
              onChange(next);
            }
          }}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm tabular-nums outline-none"
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </span>
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground/80">{label}</span>
      <ColorSwatch value={value} onChange={onChange} label={label} customLabel={t("colorPicker.custom")} />
    </div>
  );
}

const FILL_TYPES = ["none", "solid", "linear", "radial"] as const;

function stopsOf(fill: StudioFill): StudioGradientStop[] {
  if (fill.type === "linear" || fill.type === "radial") return fill.stops;
  const base = fill.type === "solid" ? fill.color : "#3b82f6";
  return [{ offset: 0, color: base }, { offset: 1, color: "#ffffff" }];
}

export function FillEditor({ value, onChange, allowNone = true }: { value: StudioFill; onChange: (fill: StudioFill, merge?: string) => void; allowNone?: boolean }) {
  const { t } = useTranslation();
  const types = allowNone ? FILL_TYPES : FILL_TYPES.filter((type) => type !== "none");
  const change = (type: (typeof FILL_TYPES)[number]) => {
    if (type === "none") onChange({ type: "none" });
    else if (type === "solid") onChange({ type: "solid", color: value.type === "solid" ? value.color : stopsOf(value)[0].color });
    else if (type === "linear") onChange({ type: "linear", angle: value.type === "linear" ? value.angle : 90, stops: stopsOf(value) });
    else onChange({ type: "radial", stops: stopsOf(value) });
  };
  const stops = value.type === "linear" || value.type === "radial" ? value.stops : null;
  const setStop = (index: number, color: string) => {
    if (!stops || (value.type !== "linear" && value.type !== "radial")) return;
    const next = stops.map((stop, position) => (position === index ? { ...stop, color } : stop));
    onChange({ ...value, stops: next });
  };
  return (
    <div className="space-y-3">
      <Segmented size="sm" value={value.type} options={types} labelOf={(type) => t(`studio.fill.${type}`)} onChange={change} ariaLabel={t("studio.fill.label")} />
      {value.type === "solid" ? <ColorField label={t("studio.fill.color")} value={value.color} onChange={(color) => onChange({ type: "solid", color })} /> : null}
      {stops ? (
        <>
          <ColorField label={t("studio.fill.start")} value={stops[0].color} onChange={(color) => setStop(0, color)} />
          <ColorField label={t("studio.fill.end")} value={stops[stops.length - 1].color} onChange={(color) => setStop(stops.length - 1, color)} />
        </>
      ) : null}
      {value.type === "linear" ? (
        <SliderField label={t("studio.fill.angle")} value={value.angle} min={0} max={360} step={5} format={(angle) => `${angle}°`} onChange={(angle) => onChange({ ...value, angle }, "fill-angle")} />
      ) : null}
    </div>
  );
}

const DASHES = ["solid", "dashed", "dotted"] as const;

export function StrokeEditor({ value, onChange }: { value: StudioStroke | null; onChange: (stroke: StudioStroke | null, merge?: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <Segmented
        size="sm"
        value={value ? "on" : "off"}
        options={["off", "on"] as const}
        labelOf={(option) => t(`studio.stroke.${option}`)}
        onChange={(option) => onChange(option === "on" ? { color: "#1f2937", width: 2, dash: "solid" } : null)}
        ariaLabel={t("studio.stroke.label")}
      />
      {value ? (
        <>
          <ColorField label={t("studio.stroke.color")} value={value.color} onChange={(color) => onChange({ ...value, color })} />
          <SliderField label={t("studio.stroke.width")} value={value.width} min={0.5} max={40} step={0.5} format={(width) => `${width} pt`} onChange={(width) => onChange({ ...value, width }, "stroke-width")} />
          <Segmented size="sm" value={value.dash} options={DASHES} labelOf={(dash) => t(`studio.stroke.${dash}`)} onChange={(dash) => onChange({ ...value, dash })} ariaLabel={t("studio.stroke.style")} />
        </>
      ) : null}
    </div>
  );
}

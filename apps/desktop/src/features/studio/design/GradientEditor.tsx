import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeftRight, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { SliderField } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import type { StudioFill } from "@/types/studio";
import { MAX_RADIAL_RADIUS, MIN_RADIAL_RADIUS } from "../model/design";
import { ColorField, NumberField, NumberInput } from "./controls";
import { addStop, canAddStop, canRemoveStop, GRADIENT_PRESETS, gradientCss, moveStop, removeStop, reverseStops, setStopColor, widestGapMiddle } from "./gradient";

type GradientFill = Extract<StudioFill, { type: "linear" | "radial" }>;
type Props = { value: GradientFill; onChange: (fill: StudioFill, merge?: string) => void };

const KEY_STEP = 0.01;
const KEY_STEP_FAR = 0.1;
const ANGLE_SNAP = 15;

function normalizeAngle(angle: number): number {
  return Math.round((((angle % 360) + 360) % 360) * 10) / 10;
}

function AngleDial({ angle, label, onChange }: { angle: number; label: string; onChange: (angle: number) => void }) {
  const dragging = useRef(false);
  const fromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const raw = (Math.atan2(dx, -dy) * 180) / Math.PI;
    onChange(normalizeAngle(event.shiftKey ? Math.round(raw / ANGLE_SNAP) * ANGLE_SNAP : Math.round(raw)));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? ANGLE_SNAP : 1;
    const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? step : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    onChange(normalizeAngle(angle + delta));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(angle)}
      aria-valuetext={`${Math.round(angle)}°`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        fromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) fromPointer(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      className="field relative size-10 shrink-0 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
        <span className="absolute left-1/2 top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-primary" />
      </span>
      <span aria-hidden className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/60" />
    </div>
  );
}

export function GradientEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const latest = useRef(value);
  const drag = useRef<{ index: number; rect: DOMRect } | null>(null);
  latest.current = value;
  const stops = value.stops;
  const index = Math.min(selected, stops.length - 1);
  const stop = stops[index];

  const update = (next: Partial<GradientFill>, merge?: string) => {
    const fill = { ...latest.current, ...next } as GradientFill;
    latest.current = fill;
    onChange(fill, merge);
  };

  const offsetFrom = (clientX: number, rect: DOMRect) => (rect.width > 0 ? (clientX - rect.left) / rect.width : 0);

  const add = (offset: number) => {
    const result = addStop(latest.current.stops, offset);
    if (!result) return;
    update({ stops: result.stops });
    setSelected(result.index);
  };

  const move = (position: number, offset: number, merge: string) => {
    const result = moveStop(latest.current.stops, position, offset);
    update({ stops: result.stops }, merge);
    setSelected(result.index);
    return result.index;
  };

  const remove = () => {
    const result = removeStop(stops, index);
    update({ stops: result.stops });
    setSelected(result.index);
  };

  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, position: number) => {
    const current = latest.current.stops[position].offset;
    const step = event.shiftKey ? KEY_STEP_FAR : KEY_STEP;
    const target =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? current + step
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? current - step
      : event.key === "Home" ? 0
      : event.key === "End" ? 1
      : null;
    if (target === null) return;
    event.preventDefault();
    const bar = event.currentTarget.parentElement;
    const next = move(position, target, "fill-stop-move");
    requestAnimationFrame(() => bar?.querySelectorAll<HTMLElement>("[data-stop-handle]")[next]?.focus());
  };

  return (
    <div className="space-y-3">
      <div className="px-2">
        <div
          data-testid="gradient-bar"
          className="relative h-6 cursor-copy touch-none rounded-md ring-1 ring-inset ring-border"
          style={{ backgroundImage: gradientCss(stops) }}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target !== event.currentTarget) return;
            add(offsetFrom(event.clientX, event.currentTarget.getBoundingClientRect()));
          }}
        >
          {stops.map((item, position) => {
            const percent = Math.round(item.offset * 1000) / 10;
            return (
              <div
                key={position}
                data-stop-handle
                role="slider"
                tabIndex={0}
                aria-label={t("studio.gradient.stop", { number: position + 1 })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`${percent}%, ${item.color}`}
                aria-current={position === index ? "true" : undefined}
                onFocus={() => setSelected(position)}
                onKeyDown={(event) => onHandleKeyDown(event, position)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const bar = event.currentTarget.parentElement;
                  if (!bar) return;
                  setSelected(position);
                  drag.current = { index: position, rect: bar.getBoundingClientRect() };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const active = drag.current;
                  if (!active) return;
                  active.index = move(active.index, offsetFrom(event.clientX, active.rect), "fill-stop-move");
                }}
                onPointerUp={(event) => {
                  drag.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                className={cn(
                  "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-background shadow-sm outline-none ring-1 ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring",
                  position === index && "size-5 ring-2 ring-primary",
                )}
                style={{ left: `${percent}%`, backgroundColor: item.color }}
              />
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("studio.gradient.hint")}</p>
      {stop ? (
        <>
          <ColorField label={t("studio.gradient.stopColor")} value={stop.color} onChange={(color) => update({ stops: setStopColor(latest.current.stops, index, color) }, `fill-stop-color-${index}`)} />
          <div className="flex items-center gap-1">
            <NumberInput className="w-20" ariaLabel={t("studio.gradient.position")} value={Math.round(stop.offset * 100)} min={0} max={100} suffix="%" onChange={(percent) => move(index, percent / 100, "fill-stop-position")} />
            <span className="flex-1" />
            <IconButton icon={Plus} label={t("studio.gradient.add")} disabled={!canAddStop(stops)} onClick={() => add(widestGapMiddle(stops))} />
            <IconButton icon={Trash2} label={t("studio.gradient.remove")} disabled={!canRemoveStop(stops)} onClick={remove} />
            <IconButton icon={ArrowLeftRight} label={t("studio.gradient.reverse")} onClick={() => update({ stops: reverseStops(stops) })} />
          </div>
        </>
      ) : null}
      {value.type === "linear" ? (
        <div className="flex items-end gap-3">
          <AngleDial angle={normalizeAngle(value.angle)} label={t("studio.fill.angle")} onChange={(angle) => update({ angle }, "fill-angle")} />
          <NumberField label={t("studio.fill.angle")} suffix="°" value={normalizeAngle(value.angle)} min={0} max={360} onChange={(angle) => update({ angle: normalizeAngle(angle) }, "fill-angle")} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3">
            <SliderField label={t("studio.gradient.centreX")} value={Math.round((value.cx ?? 0.5) * 100)} min={0} max={100} format={(percent) => `${percent}%`} onChange={(percent) => update({ cx: percent / 100 }, "fill-centre-x")} />
            <SliderField label={t("studio.gradient.centreY")} value={Math.round((value.cy ?? 0.5) * 100)} min={0} max={100} format={(percent) => `${percent}%`} onChange={(percent) => update({ cy: percent / 100 }, "fill-centre-y")} />
          </div>
          <SliderField
            label={t("studio.gradient.radius")}
            value={Math.round((value.radius ?? 1) * 100)}
            min={MIN_RADIAL_RADIUS * 100}
            max={MAX_RADIAL_RADIUS * 100}
            step={5}
            format={(percent) => `${percent}%`}
            onChange={(percent) => update({ radius: percent / 100 }, "fill-radius")}
          />
        </>
      )}
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground">{t("studio.gradient.presets")}</span>
        <div className="flex flex-wrap gap-1.5">
          {GRADIENT_PRESETS.map((preset, position) => (
            <button
              key={position}
              type="button"
              aria-label={t("studio.gradient.preset", { number: position + 1 })}
              title={t("studio.gradient.preset", { number: position + 1 })}
              onClick={() => {
                update({ stops: preset.map((item) => ({ ...item })) });
                setSelected(0);
              }}
              className="size-7 rounded-md ring-1 ring-inset ring-border outline-none transition-transform duration-(--transition-fast) hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ backgroundImage: gradientCss(preset, "135deg") }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

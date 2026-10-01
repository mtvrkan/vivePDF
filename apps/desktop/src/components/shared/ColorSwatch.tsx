import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Pipette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { isEyeDropperSupported, pickColorFromScreen } from "@/shared/lib/eyedropper";
import { hexToHsv, hsvToHex, isLightColor, isValidHex, normalizeHex, type Hsv } from "@/shared/lib/color";

const PRESETS = ["#111111", "#4b5563", "#9ca3af", "#ffffff", "#e5484d", "#ff6b00", "#f5b400", "#30a46c", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f"];
const GAP = 6;
const PANEL_WIDTH = 232;
const EDGE = 8;
const AREA_STEP = 0.02;
const HUE_STEP = 2;

type ColorSwatchProps = { value: string; onChange: (value: string) => void; label: string; customLabel: string; disabled?: boolean; presets?: string[] };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function SaturationArea({ hsv, label, onChange }: { hsv: Hsv; label: string; onChange: (next: Hsv) => void }) {
  const dragging = useRef(false);

  const applyFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange({ ...hsv, s: clamp01((event.clientX - rect.left) / rect.width), v: 1 - clamp01((event.clientY - rect.top) / rect.height) });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const horizontal = event.key === "ArrowRight" ? AREA_STEP : event.key === "ArrowLeft" ? -AREA_STEP : 0;
    const vertical = event.key === "ArrowUp" ? AREA_STEP : event.key === "ArrowDown" ? -AREA_STEP : 0;
    if (horizontal === 0 && vertical === 0) return;
    event.preventDefault();
    onChange({ h: hsv.h, s: clamp01(hsv.s + horizontal), v: clamp01(hsv.v + vertical) });
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuetext={hsvToHex(hsv)}
      aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        applyFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) applyFromPointer(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      className="relative h-32 w-full cursor-crosshair touch-none rounded-lg outline-none ring-1 ring-inset ring-black/15 focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
        backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }),
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_hsl(0_0%_0%/0.35)]"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hsvToHex(hsv) }}
      />
    </div>
  );
}

export function ColorSwatch({ value, onChange, label, customLabel, disabled, presets }: ColorSwatchProps) {
  const { t } = useTranslation();
  const swatches = presets && presets.length > 0 ? presets.map((preset) => normalizeHex(preset)) : PRESETS;
  const eyeDropperAvailable = isEyeDropperSupported();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState(value);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pickingRef = useRef(false);

  const normalized = normalizeHex(value);
  const hsv = useMemo(() => hexToHsv(normalized), [normalized]);

  useEffect(() => {
    setDraft(normalized);
  }, [normalized]);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const height = panel.getBoundingClientRect().height;
    if (anchor.top + height <= window.innerHeight - EDGE) return;
    const above = trigger.getBoundingClientRect().top - GAP - height;
    const top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - EDGE - height);
    if (Math.abs(top - anchor.top) > 1) setAnchor({ ...anchor, top });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (pickingRef.current) return;
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(Math.max(rect.left, EDGE), window.innerWidth - PANEL_WIDTH - EDGE);
      setAnchor({ top: rect.bottom + GAP, left });
    }
    setOpen(true);
  };

  const commitHsv = (next: Hsv) => onChange(hsvToHex(next));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${normalized}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        className="nav-glass inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 disabled:opacity-40"
      >
        <span className="size-5 rounded-md shadow-[inset_0_0_0_1px_hsl(0_0%_0%/0.25)] ring-1 ring-inset ring-white/25" style={{ backgroundColor: normalized }} aria-hidden />
        <span className="font-mono text-[11px] uppercase text-muted-foreground">{normalized.replace("#", "")}</span>
      </button>
      {open && anchor
        ? createPortal(
            <div ref={panelRef} role="dialog" aria-label={label} className="glass-menu fixed z-50 rounded-xl p-2.5" style={{ top: anchor.top, left: anchor.left, width: PANEL_WIDTH }}>
              <div className="grid grid-cols-6 gap-1.5">
                {swatches.map((preset) => {
                  const active = preset === normalized;
                  return (
                    <button
                      key={preset}
                      type="button"
                      aria-label={preset}
                      aria-pressed={active}
                      onClick={() => onChange(preset)}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-black/15 transition-transform duration-(--transition-fast) hover:scale-110",
                        active && "ring-2 ring-primary",
                      )}
                      style={{ backgroundColor: preset }}
                    >
                      {active ? <Check className={cn("size-3.5", isLightColor(preset) ? "text-black" : "text-white")} aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>

              <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{customLabel}</p>
              <SaturationArea hsv={hsv} label={t("colorPicker.area")} onChange={commitHsv} />

              <div className="mt-2.5 flex items-center gap-2">
                <span aria-hidden className="size-8 shrink-0 rounded-lg shadow-[inset_0_0_0_1px_hsl(0_0%_0%/0.25)] ring-1 ring-inset ring-white/25" style={{ backgroundColor: normalized }} />
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={HUE_STEP}
                  value={hsv.h}
                  aria-label={t("colorPicker.hue")}
                  onChange={(event) => commitHsv({ ...hsv, h: Number(event.target.value) })}
                  className="hue-slider w-full cursor-pointer"
                />
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">HEX</span>
                  <input
                    value={draft.replace("#", "").toUpperCase()}
                    aria-label={t("colorPicker.hex")}
                    spellCheck={false}
                    maxLength={6}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDraft(next);
                      if (isValidHex(next)) onChange(normalizeHex(next));
                    }}
                    onBlur={() => setDraft(normalized)}
                    className="field h-8 w-full rounded-lg px-2 font-mono text-xs uppercase outline-none"
                  />
                </label>
                {eyeDropperAvailable ? (
                  <button
                    type="button"
                    aria-label={t("colorPicker.pickFromScreen")}
                    title={t("colorPicker.pickFromScreen")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      pickingRef.current = true;
                      void pickColorFromScreen()
                        .then((picked) => {
                          if (picked) onChange(normalizeHex(picked));
                        })
                        .finally(() => {
                          window.setTimeout(() => {
                            pickingRef.current = false;
                          }, 0);
                        });
                    }}
                    className="nav-glass inline-flex size-8 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pipette className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

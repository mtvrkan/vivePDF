import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ControlLabelContext } from "@/components/tool/fieldDescription";
import { cn } from "@/shared/lib/cn";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import { rowMatches } from "./settingsSearch";
import { SECTION_ICONS, SettingsSearchContext, type SectionId } from "./settingsShared";
import type { ThemeMode } from "@/types";

const THEMES: ThemeMode[] = ["light", "dark", "system"];

export function RangeControl({ value, min, max, step = 1, display, onChange, ariaLabel }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <span className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={ariaLabel} className="w-40 accent-primary" />
      <span className="w-14 text-end font-mono text-xs tabular-nums text-muted-foreground">{display}</span>
    </span>
  );
}

function ThemePreview({ dark }: { dark: boolean }) {
  const surface = dark ? "hsl(222 20% 10%)" : "hsl(220 14% 97%)";
  const bar = dark ? "hsl(222 16% 15%)" : "hsl(0 0% 100%)";
  const card = dark ? "hsl(222 16% 17%)" : "hsl(0 0% 100%)";
  const line = dark ? "hsl(0 0% 100% / 0.16)" : "hsl(222 20% 12% / 0.14)";
  const edge = dark ? "hsl(0 0% 100% / 0.08)" : "hsl(222 20% 12% / 0.08)";
  return (
    <span aria-hidden className="absolute inset-0" style={{ background: surface }}>
      <span className="absolute inset-x-0 top-0 h-3.5" style={{ background: bar, boxShadow: `inset 0 -1px 0 ${edge}` }} />
      <span className="absolute left-2 top-[5px] h-1 w-7 rounded-full" style={{ background: "hsl(202 80% 46%)" }} />
      <span className="absolute left-11 top-[5px] h-1 w-4 rounded-full" style={{ background: line }} />
      <span className="absolute inset-x-2 bottom-2 top-5 rounded-md" style={{ background: card, boxShadow: `inset 0 0 0 1px ${edge}` }}>
        <span className="absolute left-2 top-2 h-1 w-10 rounded-full" style={{ background: line }} />
        <span className="absolute left-2 top-[18px] h-1 w-14 rounded-full" style={{ background: line }} />
        <span className="absolute left-2 top-7 h-1 w-8 rounded-full" style={{ background: line }} />
      </span>
    </span>
  );
}

export function ThemeCards({ value, onChange, ariaLabel }: { value: ThemeMode; onChange: (mode: ThemeMode) => void; ariaLabel: string }) {
  const { t } = useTranslation();
  const current = Math.max(0, THEMES.indexOf(value));
  const roving = useRovingRadios(THEMES, current, onChange);

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-3">
      {THEMES.map((mode, index) => {
        const selected = mode === value;
        return (
          <button
            key={mode}
            ref={roving.refOf(index)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={roving.tabIndexOf(index)}
            onKeyDown={roving.onKeyDown}
            onClick={() => onChange(mode)}
            className={cn(
              "w-36 rounded-xl p-1.5 text-start transition-[background-color,box-shadow,transform] duration-(--transition-fast)",
              selected ? "option-selected" : "nav-glass shadow-[inset_0_0_0_1px_var(--color-border)] hover:-translate-y-px",
            )}
          >
            <span className="relative block h-20 overflow-hidden rounded-lg">
              {mode === "system" ? (
                <>
                  <ThemePreview dark />
                  <span className="absolute inset-0" style={{ clipPath: "polygon(0 0, 62% 0, 38% 100%, 0 100%)" }}>
                    <ThemePreview dark={false} />
                  </span>
                </>
              ) : (
                <ThemePreview dark={mode === "dark"} />
              )}
            </span>
            <span className="mt-2 flex h-5 items-center gap-1.5 px-1 text-sm">
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", selected ? "tone-tile" : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-foreground)_22%,transparent)]")}>
                {selected ? <Check className="size-2.5" strokeWidth={3} aria-hidden /> : null}
              </span>
              <span className={cn("truncate", selected ? "font-medium text-foreground" : "text-foreground/80")}>{t(`theme.${mode}`)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

type StatusTone = "success" | "destructive" | "warning" | "primary" | "muted";

export function SettingRow({ label, hint, hintTone, hintPulse, detail, children, block }: {
  label: string;
  hint?: string;
  hintTone?: StatusTone;
  hintPulse?: boolean;
  detail?: string;
  children: ReactNode;
  block?: boolean;
}) {
  const query = useContext(SettingsSearchContext);
  const labelId = useId();
  if (!rowMatches(query, label, hint) && !rowMatches(query, label, detail)) return null;
  return (
    <div data-setting-row className={cn("border-b py-3 text-sm last:border-b-0", block ? "space-y-3" : "flex min-h-row flex-wrap items-center justify-between gap-x-6 gap-y-2")}>
      <span className={cn("min-w-0", block ? "block" : "max-w-[34rem] flex-1 basis-56")}>
        <span id={labelId} className="block text-foreground">{label}</span>
        {hint ? (
          <span className={cn("mt-0.5 flex items-start gap-1.5 text-xs leading-4", hintTone === "destructive" ? "text-destructive" : "text-muted-foreground")}>
            {hintTone ? (
              <span className="flex h-4 shrink-0 items-center">
                <StatusDot tone={hintTone} pulse={hintPulse} />
              </span>
            ) : null}
            <span>{hint}</span>
          </span>
        ) : null}
        {detail ? <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{detail}</span> : null}
      </span>
      <span className={cn(block ? "block w-full" : "ms-auto flex shrink-0 items-center justify-end gap-2")}>
        <ControlLabelContext value={labelId}>{children}</ControlLabelContext>
      </span>
    </div>
  );
}

export function SettingTile({ icon: Icon, label, value, actionLabel, onAction, disabled, danger }: {
  icon: LucideIcon;
  label: string;
  value: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const query = useContext(SettingsSearchContext);
  if (!rowMatches(query, label, value)) return null;
  return (
    <div data-setting-row className={cn("glass-flat flex items-center gap-3 rounded-xl border p-3", danger && "border-destructive/40")}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", danger ? "bg-destructive/10 text-destructive" : "tone-tile")}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{label}</span>
        <span className="line-clamp-2 block break-words text-xs leading-4 text-muted-foreground">{value}</span>
      </span>
      <Button size="sm" variant={danger ? "destructive" : "secondary"} onClick={onAction} disabled={disabled} aria-label={`${actionLabel}: ${label}`}>
        {actionLabel}
      </Button>
    </div>
  );
}

export function ActionCard({ icon: Icon, title, description, actionLabel, onClick, loading }: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
  loading?: boolean;
}) {
  const query = useContext(SettingsSearchContext);
  if (!rowMatches(query, title, description)) return null;
  return (
    <button
      type="button"
      data-setting-row
      onClick={onClick}
      aria-busy={loading || undefined}
      className="nav-glass group flex items-start gap-3 rounded-xl border p-3 text-start transition-[background-color,transform] duration-(--transition-fast) hover:-translate-y-px"
    >
      <span className="tone-tile flex size-9 shrink-0 items-center justify-center rounded-lg">
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
      <span className="mt-0.5 shrink-0 text-xs font-medium text-primary">{actionLabel}</span>
    </button>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="border-b py-3 text-xs leading-4 text-muted-foreground last:border-b-0">{children}</p>;
}

export function Mono({ children }: { children: string }) {
  return (
    <span className="max-w-96 truncate font-mono text-xs text-muted-foreground" title={children}>
      {children}
    </span>
  );
}

function StatusDot({ tone, pulse }: { tone: "success" | "destructive" | "warning" | "primary" | "muted"; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 rounded-full",
        tone === "success" && "bg-success",
        tone === "destructive" && "bg-destructive",
        tone === "warning" && "bg-warning",
        tone === "primary" && "bg-primary",
        tone === "muted" && "bg-muted-foreground",
        pulse && "animate-pulse",
      )}
    />
  );
}

export function SectionCard({ id, query, actions, onEmptyChange, children }: {
  id: SectionId;
  query: string;
  actions?: ReactNode;
  onEmptyChange: (id: SectionId, empty: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const [empty, setEmpty] = useState(false);
  const Icon = SECTION_ICONS[id];
  const title = t(`settings.sections.${id}.title`);
  const description = t(`settings.sections.${id}.description`);
  const rowQuery = rowMatches(query, title, description) ? "" : query;

  useLayoutEffect(() => {
    const next = rowQuery !== "" && ref.current?.querySelector("[data-setting-row]") === null;
    setEmpty(next);
    onEmptyChange(id, next);
  }, [rowQuery, children, id, onEmptyChange]);

  useEffect(() => () => onEmptyChange(id, false), [id, onEmptyChange]);

  return (
    <section ref={ref} id={`settings-${id}`} data-settings-section={id} hidden={empty} className="glass scroll-mt-6 rounded-2xl px-5 pb-2 pt-5">
      <header className="mb-1 flex items-start gap-3 border-b pb-4">
        <span className="tone-tile flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-5">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </span>
        {actions ? <span className="flex shrink-0 items-center gap-2">{actions}</span> : null}
      </header>
      <SettingsSearchContext.Provider value={rowQuery}>{children}</SettingsSearchContext.Provider>
    </section>
  );
}

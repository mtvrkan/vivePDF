import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { useUiStore } from "@/shared/store/uiStore";

const PANEL_WIDTH = 304;
const PANEL_GAP = 6;
const EDGE = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

type DateRangePickerProps = {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  className?: string;
  ariaLabel: string;
};

type Preset = { key: "last7" | "last30" | "thisYear"; range: () => [string, string] };

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstWeekday(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (first) return first % 7;
  } catch {
    return 1;
  }
  return 1;
}

function monthGrid(year: number, month: number, weekStart: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

const PRESETS: Preset[] = [
  { key: "last7", range: () => [toIso(new Date(Date.now() - 6 * DAY_MS)), toIso(new Date())] },
  { key: "last30", range: () => [toIso(new Date(Date.now() - 29 * DAY_MS)), toIso(new Date())] },
  { key: "thisYear", range: () => [`${new Date().getFullYear()}-01-01`, toIso(new Date())] },
];

export function DateRangePicker({ start, end, onChange, className, ariaLabel }: DateRangePickerProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState(() => {
    const base = fromIso(start) ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  const weekStart = useMemo(() => firstWeekday(locale), [locale]);
  const dayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }), [locale]);
  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) => weekdayFormatter.format(new Date(2024, 0, 7 + ((weekStart + index) % 7)))), [weekdayFormatter, weekStart]);
  const days = useMemo(() => monthGrid(view.year, view.month, weekStart), [view, weekStart]);
  const today = toIso(new Date());

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(rect.left, EDGE), window.innerWidth - PANEL_WIDTH - EDGE);
    setAnchor({ top: rect.bottom + PANEL_GAP, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openPanel = () => {
    const base = fromIso(start) ?? new Date();
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setPending(null);
    setOpen(true);
  };

  const shiftMonth = (delta: number) => {
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const pick = (iso: string) => {
    if (!pending) {
      setPending(iso);
      return;
    }
    const [from, to] = pending <= iso ? [pending, iso] : [iso, pending];
    onChange(from, to);
    setPending(null);
    setOpen(false);
  };

  const clear = () => {
    onChange("", "");
    setPending(null);
    setOpen(false);
  };

  const rangeStart = pending ?? start;
  const rangeEnd = pending ? (hovered ?? pending) : end;
  const [lo, hi] = rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart]) : [rangeStart, rangeEnd];
  const label = start || end ? `${start ? dayFormatter.format(fromIso(start) as Date) : "…"} – ${end ? dayFormatter.format(fromIso(end) as Date) : "…"}` : t("dateRange.placeholder");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          "field flex h-7 items-center gap-2 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
          start || end ? "text-foreground" : "text-muted-foreground",
          className,
        )}
      >
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="whitespace-nowrap">{label}</span>
        {start || end ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={t("dateRange.clear")}
            onClick={(event) => {
              event.stopPropagation();
              clear();
            }}
            className="ms-0.5 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </span>
        ) : null}
      </button>
      {open && anchor
        ? createPortal(
            <div ref={panelRef} role="dialog" aria-label={ariaLabel} className="glass-menu fixed z-50 rounded-xl p-3" style={{ top: anchor.top, left: anchor.left, width: PANEL_WIDTH }}>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label={t("dateRange.previousMonth")} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <span className="text-sm font-semibold capitalize">{monthFormatter.format(new Date(view.year, view.month, 1))}</span>
                <button type="button" onClick={() => shiftMonth(1)} aria-label={t("dateRange.nextMonth")} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                {weekdays.map((day) => (
                  <span key={day} className="py-1">
                    {day}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHovered(null)}>
                {days.map((day) => {
                  const iso = toIso(day);
                  const outside = day.getMonth() !== view.month;
                  const inRange = Boolean(lo && hi && iso >= lo && iso <= hi);
                  const isEdge = iso === lo || iso === hi;
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => pick(iso)}
                      onMouseEnter={() => setHovered(iso)}
                      aria-pressed={isEdge}
                      className={cn(
                        "relative mx-auto flex size-8 items-center justify-center rounded-lg text-sm tabular-nums outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
                        outside ? "text-muted-foreground/50" : "text-foreground",
                        inRange && !isEdge && "bg-primary/10",
                        isEdge && "bg-primary font-semibold text-primary-foreground",
                        !isEdge && "hover:bg-(--hover-bg)",
                        iso === today && !isEdge && "ring-1 ring-inset ring-primary/50",
                      )}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => {
                      const [from, to] = preset.range();
                      onChange(from, to);
                      setPending(null);
                      setOpen(false);
                    }}
                    className="glass-chip rounded-full px-2.5 py-1 text-xs text-foreground/80 hover:text-foreground"
                  >
                    {t(`dateRange.${preset.key}`)}
                  </button>
                ))}
                <button type="button" onClick={clear} className="ms-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
                  {t("dateRange.clear")}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { computeSelectPlacement } from "./selectPlacement";

export type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
  id?: string;
  ariaLabel?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
};

type Placement = { left: number; top: number; width: number; above: boolean; tone: string };

const LIST_MAX_HEIGHT = 288;

const sizeClass = {
  sm: "h-7 rounded-md px-2 text-xs",
  md: "h-row rounded-lg px-3 text-base",
};

export function Select({ value, options, onChange, size = "md", className, disabled, placeholder, mono, id, ariaLabel, searchable, searchPlaceholder, emptyLabel }: SelectProps) {
  const reactId = useId();
  const listId = `${reactId}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [placement, setPlacement] = useState<Placement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const needle = searchable ? query.trim().toLocaleLowerCase() : "";
  const visible = useMemo(
    () => (needle ? options.filter((option) => !option.disabled && option.label.toLocaleLowerCase().includes(needle)) : options),
    [needle, options],
  );
  const visibleSelected = visible.findIndex((option) => option.value === value);
  const [highlight, setHighlight] = useState(selectedIndex);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const next = computeSelectPlacement(rect, { width: window.innerWidth, height: window.innerHeight }, visible.length);
    setPlacement({ ...next, tone: getComputedStyle(trigger).getPropertyValue("--tone") });
  }, [visible.length]);

  const openList = useCallback(() => {
    if (disabled) return;
    setQuery("");
    setHighlight(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
    measure();
    setOpen(true);
  }, [disabled, measure, options, selectedIndex]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = visible[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      setOpen(false);
      setQuery("");
      triggerRef.current?.focus();
    },
    [onChange, visible],
  );

  const move = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      let next = highlight;
      for (let step = 0; step < visible.length; step += 1) {
        next = (next + delta + visible.length) % visible.length;
        if (!visible[next]?.disabled) break;
      }
      setHighlight(next);
    },
    [highlight, visible],
  );

  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      measure();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  useLayoutEffect(() => {
    if (!open || highlight < 0) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) openList();
        else move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) openList();
        else move(-1);
        break;
      case "Home":
        if (open) {
          event.preventDefault();
          setHighlight(visible.findIndex((option) => !option.disabled));
        }
        break;
      case "End":
        if (open) {
          event.preventDefault();
          setHighlight(visible.length - 1);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (open) commit(highlight);
        else openList();
        break;
      case " ":
        if (open && event.currentTarget.tagName === "INPUT") break;
        event.preventDefault();
        if (open) commit(highlight);
        else openList();
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          close();
        }
        break;
      case "Tab":
        if (open) close();
        break;
      default:
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        data-open={open ? "true" : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "field flex items-center justify-between gap-2 text-start disabled:opacity-50",
          sizeClass[size],
          !(className ?? "").split(" ").some((token) => token.startsWith("w-")) && "w-full",
          mono && "font-mono tabular-nums",
          className,
        )}
      >
        <span title={selected?.label ?? placeholder ?? ""} className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder ?? ""}</span>
        <ChevronDown className={cn("shrink-0 text-muted-foreground transition-transform duration-(--transition-fast)", size === "sm" ? "size-3.5" : "size-4", open && "rotate-180")} aria-hidden />
      </button>
      {open && placement
        ? createPortal(
            <>
              <div
                aria-hidden
                className="fixed inset-0 z-40 bg-transparent"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                }}
              />
              <div
                ref={listRef}
              className={cn("select-pop glass-menu fixed z-50 overflow-hidden rounded-xl", placement.above ? "origin-bottom" : "origin-top")}
              style={{
                ["--tone" as string]: placement.tone,
                left: placement.left,
                width: placement.width,
                top: placement.above ? undefined : placement.top,
                bottom: placement.above ? window.innerHeight - placement.top : undefined,
              }}
            >
              {searchable ? (
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setHighlight(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={searchPlaceholder ?? ""}
                    aria-label={searchPlaceholder ?? ariaLabel}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              ) : null}
              <div id={listId} role="listbox" aria-label={ariaLabel} className="overflow-y-auto overflow-x-hidden p-1" style={{ maxHeight: LIST_MAX_HEIGHT }}>
              {visible.length === 0 && emptyLabel ? <div className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</div> : null}
              {visible.map((option, index) => {
                const isSelected = index === visibleSelected;
                const isHighlighted = index === highlight;
                return (
                  <div
                    key={option.value}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onPointerMove={() => !option.disabled && setHighlight(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      "flex cursor-default items-center justify-between gap-3 rounded-lg px-3 transition-colors duration-(--transition-fast)",
                      size === "sm" ? "h-8 text-xs" : "h-9 text-sm",
                      mono && "font-mono tabular-nums",
                      isHighlighted && !option.disabled && "bg-(--hover-bg)",
                      isSelected && "text-(--tone)",
                      option.disabled && "opacity-40",
                    )}
                  >
                    <span title={option.label} className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected ? <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
                  </div>
                );
              })}
              </div>
            </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

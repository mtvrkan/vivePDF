import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { routeIsActive } from "@/app/navigation";
import { cn } from "@/shared/lib/cn";
import type { Tone } from "@/types";

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;

type HeaderMenuProps = {
  id: string;
  label: string;
  menuLabel?: string;
  icon?: LucideIcon;
  active: boolean;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  panelClassName?: string;
  variant?: "menubar" | "eyebrow";
  iconOnly?: boolean;
  children: ReactNode;
};

export function HeaderMenu({ id, label, menuLabel, icon: Icon, active, openId, onOpenChange, panelClassName, variant = "menubar", iconOnly = false, children }: HeaderMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const open = openId === id;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
    setAnchor({ top: rect.bottom + MENU_GAP, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onOpenChange(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onOpenChange]);

  const focusItem = useCallback((direction: 1 | -1 | "first" | "last") => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (direction === "first") next = 0;
    else if (direction === "last") next = items.length - 1;
    else next = current === -1 ? (direction === 1 ? 0 : items.length - 1) : (current + direction + items.length) % items.length;
    items[next]?.focus();
  }, []);

  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(null);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem("first");
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem("last");
    } else if (event.key === "Tab") {
      onOpenChange(null);
      triggerRef.current?.focus();
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || (event.key === "Enter" && !open) || event.key === " ") {
      event.preventDefault();
      onOpenChange(id);
      requestAnimationFrame(() => focusItem("first"));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      onOpenChange(null);
    } else if (event.key === "Tab" && open) {
      onOpenChange(null);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel ?? (iconOnly ? label : undefined)}
        title={menuLabel ?? (iconOnly ? label : undefined)}
        onClick={() => onOpenChange(open ? null : id)}
        onMouseEnter={() => {
          if (openId !== null && openId !== id) onOpenChange(id);
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "shrink-0 items-center gap-1 outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
          variant === "eyebrow"
            ? "-mx-1 inline-flex min-h-6 rounded px-1 uppercase tracking-[0.08em] hover:bg-(--hover-bg)"
            : cn(
                "flex h-8 rounded-lg px-2.5 text-sm",
                active || open ? "menubar-active font-medium text-foreground" : "text-foreground/80 hover:bg-(--hover-bg) hover:text-foreground",
              ),
        )}
      >
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span className={iconOnly ? "sr-only" : "whitespace-nowrap"}>{label}</span>
        {iconOnly ? null : (
          <ChevronDown
            className={cn(
              "transition-transform duration-(--transition-fast)",
              variant === "eyebrow" ? "size-3" : "size-3.5 text-muted-foreground",
              open && "rotate-180",
            )}
            aria-hidden
          />
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label={menuLabel ?? label}
              onKeyDown={onPanelKeyDown}
              onClickCapture={(event) => {
                if (event.currentTarget.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true });
              }}
              className={cn("glass-menu fixed z-50 max-h-[calc(100vh-4rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl p-2", panelClassName)}
              style={{ top: anchor?.top ?? -9999, left: anchor?.left ?? -9999, visibility: anchor ? "visible" : "hidden" }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type MenuLinkProps = {
  icon?: LucideIcon;
  label: string;
  route?: string;
  tone?: Tone;
  active?: boolean;
  onSelect: () => void;
  onClick?: () => void;
};

export function MenuLink({ icon: Icon, label, route, tone, active, onSelect, onClick }: MenuLinkProps) {
  const location = useLocation();
  const isActive = active ?? (route ? routeIsActive(route, location.pathname, location.search) : false);
  const className = cn(
    "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
    isActive ? "menubar-active font-medium text-foreground" : "text-foreground/85 hover:bg-(--hover-bg) hover:text-foreground",
  );
  const iconClassName = cn("size-4 shrink-0", tone ? "text-(--tone)" : "text-muted-foreground");
  const icon = Icon ? <Icon className={iconClassName} aria-hidden /> : <span className="size-4 shrink-0" aria-hidden />;

  if (route) {
    return (
      <Link to={route} role="menuitem" data-tone={tone} aria-current={isActive ? "page" : undefined} onClick={onSelect} className={className}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={isActive}
      data-tone={tone}
      onClick={() => {
        onClick?.();
        onSelect();
      }}
      className={className}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-start">{label}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1.5 h-px bg-border" />;
}

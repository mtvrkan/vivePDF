import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/cn";

export const MENU_LAYER = "data-context-menu-layer";

export type ContextMenuAnchor = { x: number; y: number; alignEnd?: boolean };

export type ContextMenuItem =
  | { type: "separator"; id: string }
  | { type: "item"; id: string; label: string; icon?: LucideIcon; swatch?: string; shortcut?: string; disabled?: boolean; checked?: boolean; onSelect: () => void }
  | { type: "submenu"; id: string; label: string; icon?: LucideIcon; disabled?: boolean; items: ContextMenuItem[] };

function flattenSelectable(items: ContextMenuItem[]): string[] {
  return items.filter((item) => item.type !== "separator" && !item.disabled).map((item) => item.id);
}

function useClampedPosition(anchor: ContextMenuAnchor, ref: React.RefObject<HTMLDivElement | null>) {
  const [style, setStyle] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    const x = anchor.alignEnd ? anchor.x - rect.width : anchor.x;
    const left = Math.min(Math.max(margin, x), window.innerWidth - rect.width - margin);
    const top = Math.min(Math.max(margin, anchor.y), window.innerHeight - rect.height - margin);
    setStyle({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [anchor, ref]);
  return style;
}

function useRovingFocus(items: ContextMenuItem[], containerRef: React.RefObject<HTMLDivElement | null>) {
  const [activeId, setActiveId] = useState<string | null>(() => flattenSelectable(items)[0] ?? null);
  const selectable = flattenSelectable(items);

  useEffect(() => {
    if (!activeId) return;
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-menu-id="${activeId}"]`);
    node?.focus();
  }, [activeId, containerRef]);

  const move = useCallback(
    (delta: number) => {
      if (selectable.length === 0) return;
      const index = activeId ? selectable.indexOf(activeId) : -1;
      const next = (index + delta + selectable.length) % selectable.length;
      setActiveId(selectable[next]);
    },
    [activeId, selectable],
  );

  const moveToStart = useCallback(() => setActiveId(selectable[0] ?? null), [selectable]);
  const moveToEnd = useCallback(() => setActiveId(selectable[selectable.length - 1] ?? null), [selectable]);

  return { activeId, setActiveId, move, moveToStart, moveToEnd };
}

function ContextMenuItems({
  items,
  label,
  onClose,
  depth,
}: {
  items: ContextMenuItem[];
  label: string;
  onClose: () => void;
  depth: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { activeId, setActiveId, move, moveToStart, moveToEnd } = useRovingFocus(items, containerRef);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [submenuAnchor, setSubmenuAnchor] = useState<ContextMenuAnchor | null>(null);

  const activateItem = (item: ContextMenuItem) => {
    if (item.type === "item") {
      if (item.disabled) return;
      item.onSelect();
      onClose();
    } else if (item.type === "submenu") {
      const node = containerRef.current?.querySelector<HTMLElement>(`[data-menu-id="${item.id}"]`);
      const rect = node?.getBoundingClientRect();
      if (rect) {
        setSubmenuAnchor({ x: rect.right, y: rect.top });
        setOpenSubmenuId(item.id);
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveToStart();
    } else if (event.key === "End") {
      event.preventDefault();
      moveToEnd();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const active = items.find((item) => item.id === activeId);
      if (active) activateItem(active);
    } else if (event.key === "ArrowRight") {
      const active = items.find((item) => item.id === activeId);
      if (active?.type === "submenu") {
        event.preventDefault();
        activateItem(active);
      }
    } else if (event.key === "Escape" || (event.key === "ArrowLeft" && depth > 0)) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div ref={containerRef} role="menu" aria-label={label} className="glass-menu min-w-56 rounded-xl p-1 focus:outline-none" onKeyDown={onKeyDown}>
      {items.map((item) => {
        if (item.type === "separator") return <div key={item.id} role="separator" className="my-1 h-px bg-border" />;
        const Icon = item.icon;
        const isActive = item.id === activeId;
        if (item.type === "submenu") {
          return (
            <div key={item.id} className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenuId === item.id}
                data-menu-id={item.id}
                tabIndex={isActive ? 0 : -1}
                disabled={item.disabled}
                onFocus={() => setActiveId(item.id)}
                onMouseEnter={() => activateItem(item)}
                onClick={() => activateItem(item)}
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-secondary focus:bg-secondary focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {Icon ? <Icon className="size-4" aria-hidden /> : null}
                <span className="flex-1 text-left">{item.label}</span>
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
              </button>
              {openSubmenuId === item.id && submenuAnchor
                ? createPortal(
                    <ContextMenu anchor={submenuAnchor} items={item.items} label={item.label} onClose={onClose} depth={depth + 1} />,
                    document.body,
                  )
                : null}
            </div>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            data-menu-id={item.id}
            tabIndex={isActive ? 0 : -1}
            disabled={item.disabled}
            onFocus={() => setActiveId(item.id)}
            onMouseEnter={() => {
              setActiveId(item.id);
              setOpenSubmenuId(null);
            }}
            onClick={() => activateItem(item)}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-secondary focus:bg-secondary focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {Icon ? <Icon className="size-4" aria-hidden /> : null}
            {item.swatch ? <span aria-hidden className="size-3.5 shrink-0 rounded-full ring-1 ring-foreground/15" style={{ background: item.swatch }} /> : null}
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut ? <span className="text-xs text-muted-foreground">{item.shortcut}</span> : null}
            {item.checked ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ContextMenu({
  anchor,
  items,
  label,
  onClose,
  depth = 0,
}: {
  anchor: ContextMenuAnchor;
  items: ContextMenuItem[];
  label: string;
  onClose: () => void;
  depth?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const style = useClampedPosition(anchor, wrapperRef);

  useEffect(() => {
    if (depth > 0) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[${MENU_LAYER}]`)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, depth]);

  return createPortal(
    <div ref={wrapperRef} {...{ [MENU_LAYER]: "" }} className={cn("fixed z-[100]")} style={{ left: style.left, top: style.top }}>
      <ContextMenuItems items={items} label={label} onClose={onClose} depth={depth} />
    </div>,
    document.body,
  );
}

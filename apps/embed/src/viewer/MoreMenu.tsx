import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { Icon, type IconName } from "./Icon";
import { useT } from "./i18nContext";

export type MenuItem =
  | { kind: "action"; id: string; label: string; icon: IconName; narrowOnly?: boolean; onSelect: () => void }
  | { kind: "radio"; id: string; label: string; icon: IconName; narrowOnly?: boolean; checked: boolean; onSelect: () => void }
  | { kind: "separator"; id: string; narrowOnly?: boolean };

type MoreMenuProps = { open: boolean; onOpenChange: (open: boolean) => void; items: MenuItem[] };

function visibleItems(menu: HTMLElement | null): HTMLButtonElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLButtonElement>(".vp-menu-item")).filter((item) => item.getClientRects().length > 0);
}

export function MoreMenu({ open, onOpenChange, items }: MoreMenuProps) {
  const t = useT();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    visibleItems(menuRef.current)[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (anchorRef.current && !event.composedPath().includes(anchorRef.current)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      restoreFocusRef.current = true;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  const close = () => {
    restoreFocusRef.current = true;
    onOpenChange(false);
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const entries = visibleItems(menuRef.current);
    const index = entries.indexOf(event.target as HTMLButtonElement);
    const move = (next: number) => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(entries.length - 1);
    else if (event.key === "Tab") onOpenChange(false);
  };

  return (
    <span ref={anchorRef} class="vp-menu-anchor">
      <button
        ref={triggerRef}
        class="vp-btn"
        type="button"
        aria-label={t("more")}
        title={t("more")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          if (!open) onOpenChange(true);
          else visibleItems(menuRef.current)[0]?.focus();
        }}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <ul ref={menuRef} class="vp-menu vp-glass" role="menu" aria-label={t("more")} onKeyDown={onMenuKeyDown}>
          {items.map((item) => {
            const scope = item.narrowOnly ? "vp-narrow-only" : undefined;
            if (item.kind === "separator") return <li key={item.id} role="separator" class={scope}><div class="vp-menu-sep" /></li>;
            return (
              <li key={item.id} role="none" class={scope}>
                <button
                  class="vp-menu-item"
                  type="button"
                  role={item.kind === "radio" ? "menuitemradio" : "menuitem"}
                  aria-checked={item.kind === "radio" ? item.checked : undefined}
                  tabIndex={-1}
                  onClick={() => {
                    item.onSelect();
                    close();
                  }}
                >
                  <Icon name={item.icon} />
                  {item.label}
                  {item.kind === "radio" ? (
                    <span class="vp-check">
                      <Icon name="check" />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </span>
  );
}

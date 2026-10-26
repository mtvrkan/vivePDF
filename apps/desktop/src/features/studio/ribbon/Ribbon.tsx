import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { ContextMenu, MENU_LAYER, type ContextMenuAnchor, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { cn } from "@/shared/lib/cn";
import { shortcutLabel } from "@/shared/lib/platform";

const MENU_GAP = 4;

export type RibbonTab = { id: string; label: string; contextual?: boolean };

type RibbonProps = {
  label: string;
  tabs: RibbonTab[];
  active: string;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  collapseLabel: string;
  expandLabel: string;
  children: ReactNode;
};

export function Ribbon({ label, tabs, active, onSelect, collapsed, onCollapsedChange, collapseLabel, expandLabel, children }: RibbonProps) {
  const prefix = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (id: string) => `${prefix}-tab-${id}`;
  const panelId = `${prefix}-panel`;

  const choose = (id: string) => {
    onSelect(id);
    if (collapsed) onCollapsedChange(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null || tabs.length === 0) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    onSelect(target.id);
    tabRefs.current[target.id]?.focus();
  };

  return (
    <div className="glass shrink-0 border-b border-border/60" data-testid="ribbon">
      <div className="flex items-center gap-1 px-3 pt-1.5">
        <div role="tablist" aria-label={label} className="flex items-center gap-0.5" onKeyDown={onKeyDown}>
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[tab.id] = node;
                }}
                type="button"
                role="tab"
                id={tabId(tab.id)}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                data-ribbon-tab={tab.id}
                onClick={() => choose(tab.id)}
                className={cn(
                  "h-8 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground",
                  selected && !collapsed && "glass-chip text-foreground",
                  tab.contextual && "font-semibold text-primary hover:text-primary",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={panelId}
          title={collapsed ? expandLabel : collapseLabel}
          className="nav-glass ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {collapsed ? expandLabel : collapseLabel}
          {collapsed ? <ChevronDown className="size-4" aria-hidden /> : <ChevronUp className="size-4" aria-hidden />}
        </button>
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(active)} hidden={collapsed} className="@container overflow-x-auto overflow-y-hidden px-1 pb-1.5 pt-1">
        <div role="toolbar" aria-label={tabs.find((tab) => tab.id === active)?.label ?? label} className="flex h-24 min-w-max items-stretch">
          {children}
        </div>
      </div>
    </div>
  );
}

export function RibbonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-col justify-between gap-1 border-r border-border/60 px-2.5 last:border-r-0", className)}>
      <div className="flex min-h-0 flex-1 items-center gap-1">{children}</div>
      <span className="text-center text-2xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

export function RibbonRows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col justify-center gap-1">{children}</div>;
}

export function RibbonRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

type RibbonButtonProps = {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  menu?: ContextMenuItem[];
  testId?: string;
};

export function RibbonButton({ icon: Icon, label, onClick, shortcut, active = false, disabled = false, menu, testId }: RibbonButtonProps) {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const button = (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcutLabel(shortcut)})` : label}
      aria-pressed={menu ? undefined : active || undefined}
      aria-haspopup={menu ? "menu" : undefined}
      aria-expanded={menu ? anchor !== null : undefined}
      disabled={disabled}
      data-testid={testId}
      onClick={(event) => {
        if (!menu) {
          onClick?.();
          return;
        }
        if (anchor) {
          setAnchor(null);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ x: rect.left, y: rect.bottom + MENU_GAP });
      }}
      className={cn(
        "nav-glass flex h-16 min-w-14 max-w-24 flex-col items-center justify-center gap-1 rounded-lg px-1.5 text-xs leading-tight text-foreground/85 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "glass-chip text-primary",
      )}
    >
      <Icon className="size-5" strokeWidth={1.6} aria-hidden />
      <span className="text-center">
        {label}
        {menu ? <ChevronDown className="ml-0.5 inline-block size-3 align-middle text-muted-foreground" aria-hidden /> : null}
      </span>
    </button>
  );
  if (!menu) return button;
  return (
    <span {...{ [MENU_LAYER]: "" }} className="inline-flex">
      {button}
      {anchor ? <ContextMenu anchor={anchor} items={menu} label={label} onClose={() => setAnchor(null)} /> : null}
    </span>
  );
}

export function RibbonSmallButton({ icon: Icon, label, onClick, shortcut, testId, active, disabled = false }: { icon: LucideIcon; label: string; onClick: () => void; shortcut?: string; testId?: string; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcutLabel(shortcut)})` : label}
      data-testid={testId}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn("nav-glass inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground/85 hover:text-foreground disabled:pointer-events-none disabled:opacity-40", active && "glass-chip text-primary")}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

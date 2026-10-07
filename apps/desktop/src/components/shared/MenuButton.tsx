import { useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { ContextMenu, MENU_LAYER, type ContextMenuAnchor, type ContextMenuItem } from "@/components/shared/ContextMenu";

const MENU_GAP = 4;

export function MenuButton({ icon: Icon, label, items, disabled = false }: { icon: LucideIcon; label: string; items: ContextMenuItem[]; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);

  const toggle = (trigger: HTMLButtonElement) => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setAnchor({ x: rect.left, y: rect.bottom + MENU_GAP });
  };

  return (
    <span {...{ [MENU_LAYER]: "" }} className="inline-flex">
      <Button size="sm" icon={<Icon className="size-4" aria-hidden />} aria-haspopup="menu" aria-expanded={anchor !== null} onClick={(event) => toggle(event.currentTarget)} disabled={disabled}>
        {label}
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
      </Button>
      {anchor ? <ContextMenu anchor={anchor} items={items} label={label} onClose={() => setAnchor(null)} /> : null}
    </span>
  );
}

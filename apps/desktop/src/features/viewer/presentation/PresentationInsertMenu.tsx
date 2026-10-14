import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenu, MENU_LAYER, type ContextMenuAnchor, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { IconButton } from "@/components/shared/IconButton";
import { DRAWING_SPECS } from "@/features/viewer/overlay/drawing/drawingKinds";
import { DRAWING_KINDS } from "@/features/viewer/overlay/drawing/drawingSource";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { openPresentationDrawing } from "./drawingInsert";

const MENU_GAP = 6;

export function PresentationInsertMenu({ opensUp = false, onOpenChange }: { opensUp?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const editing = useViewerOverlayStore((state) => state.mode !== null);
  const onBoard = usePresentationStore((state) => state.blackout !== "none");
  const label = t("presentation.insert.menu");

  const items: ContextMenuItem[] = DRAWING_KINDS.map((kind) => ({
    type: "item",
    id: kind,
    label: t(DRAWING_SPECS[kind].labels.menu),
    icon: DRAWING_SPECS[kind].icon,
    onSelect: () => openPresentationDrawing(kind),
  }));

  const show = (next: ContextMenuAnchor | null) => {
    setAnchor(next);
    onOpenChange?.(next !== null);
  };

  const toggle = (trigger: HTMLButtonElement) => {
    if (anchor) {
      show(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    show(opensUp ? { x: rect.left, y: rect.top - MENU_GAP, above: true } : { x: rect.left, y: rect.bottom + MENU_GAP });
  };

  return (
    <span {...{ [MENU_LAYER]: "" }} className="inline-flex">
      <IconButton icon={Plus} label={label} aria-haspopup="menu" aria-expanded={anchor !== null} active={anchor !== null} disabled={editing || onBoard} data-presentation-insert="" onClick={(event) => toggle(event.currentTarget)} />
      {anchor ? <ContextMenu anchor={anchor} items={items} label={label} onClose={() => show(null)} /> : null}
    </span>
  );
}

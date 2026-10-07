import type { TFunction } from "i18next";
import { ArrowDownUp, ArrowRightLeft, BookOpen, ClipboardCopy, ClipboardPaste, ClipboardX, Copy, CopyPlus, Eye, FileOutput, FilePlus2, Images, Printer, RotateCcw, RotateCw, Scissors, Tag, Trash2 } from "lucide-react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { OrganizerTile } from "@/types";
import { MAIN_SOURCE_ID } from "./organizerStore";

export type TileMenuContext = {
  t: TFunction;
  tiles: OrganizerTile[];
  selected: ReadonlySet<string>;
  cuts: ReadonlySet<string>;
  busy: boolean;
  canPaste: boolean;
  onPreview: (key: string) => void;
  onOpenInViewer: (tile: OrganizerTile) => void;
  onRotate: (delta: 90 | -90) => void;
  onDuplicate: () => void;
  onCopies: () => void;
  onReverse: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onToggleCut: (key: string) => void;
  onExtract: () => void;
  onSaveImages: () => void;
  onPrint: () => void;
  onInsertBlank: () => void;
  onLabel: (key: string) => void;
  onMove: () => void;
};

export function tileMenuItems(key: string, context: TileMenuContext): ContextMenuItem[] {
  const { t, tiles, selected, cuts, busy } = context;
  const position = tiles.findIndex((tile) => tile.key === key);
  const tile = tiles[position];
  if (!tile) return [];
  const isLast = position === tiles.length - 1;
  const count = selected.has(key) ? selected.size : 1;
  return [
    { type: "item", id: "preview", label: t("tools.pages.menu.preview"), icon: Eye, shortcut: "Space", onSelect: () => context.onPreview(key) },
    { type: "item", id: "viewer", label: t("tools.pages.menu.openInViewer"), icon: BookOpen, disabled: tile.kind !== "page" || tile.sourceId !== MAIN_SOURCE_ID, onSelect: () => context.onOpenInViewer(tile) },
    { type: "separator", id: "view-end" },
    { type: "item", id: "rotate-left", label: t("tools.pages.rotateLeft"), icon: RotateCcw, shortcut: "Shift+R", onSelect: () => context.onRotate(-90) },
    { type: "item", id: "rotate-right", label: t("tools.pages.rotateRight"), icon: RotateCw, shortcut: "R", onSelect: () => context.onRotate(90) },
    { type: "item", id: "duplicate", label: t("tools.pages.duplicate"), icon: Copy, shortcut: "Ctrl+D", onSelect: context.onDuplicate },
    { type: "item", id: "copies", label: t("tools.pages.copies.menu"), icon: CopyPlus, onSelect: context.onCopies },
    { type: "item", id: "reverse", label: t("tools.pages.reverseSelection"), icon: ArrowDownUp, disabled: count < 2, onSelect: context.onReverse },
    { type: "item", id: "delete", label: t("tools.pages.delete"), icon: Trash2, shortcut: "Delete", disabled: count >= tiles.length, onSelect: context.onDelete },
    { type: "item", id: "move", label: t("tools.pages.menu.move", { count }), icon: ArrowRightLeft, shortcut: "M", disabled: count >= tiles.length, onSelect: context.onMove },
    { type: "separator", id: "clipboard-start" },
    { type: "item", id: "copy", label: t("tools.pages.clipboard.copy"), icon: ClipboardCopy, shortcut: "Ctrl+C", onSelect: context.onCopy },
    { type: "item", id: "cut-pages", label: t("tools.pages.clipboard.cut"), icon: ClipboardX, shortcut: "Ctrl+X", disabled: count >= tiles.length, onSelect: context.onCut },
    { type: "item", id: "paste", label: t("tools.pages.clipboard.paste"), icon: ClipboardPaste, shortcut: "Ctrl+V", disabled: !context.canPaste, onSelect: context.onPaste },
    { type: "separator", id: "edit-end" },
    {
      type: "item",
      id: "cut",
      label: t(cuts.has(key) ? "tools.pages.menu.removeCut" : "tools.pages.menu.cutHere"),
      icon: Scissors,
      disabled: isLast,
      onSelect: () => context.onToggleCut(key),
    },
    { type: "item", id: "extract", label: t("tools.pages.menu.extract", { count }), icon: FileOutput, shortcut: "Ctrl+E", disabled: busy, onSelect: context.onExtract },
    { type: "item", id: "images", label: t("tools.pages.exportImages.menu"), icon: Images, disabled: busy, onSelect: context.onSaveImages },
    { type: "item", id: "print", label: t("tools.pages.print.menu"), icon: Printer, shortcut: "Ctrl+P", disabled: busy, onSelect: context.onPrint },
    { type: "separator", id: "output-end" },
    { type: "item", id: "blank", label: t("tools.pages.menu.insertBlank"), icon: FilePlus2, shortcut: "B", onSelect: context.onInsertBlank },
    { type: "item", id: "label", label: t("tools.pages.menu.label"), icon: Tag, onSelect: () => context.onLabel(key) },
  ];
}

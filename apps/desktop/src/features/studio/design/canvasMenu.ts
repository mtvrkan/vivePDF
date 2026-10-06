import { ArrowDownToLine, ArrowUpToLine, ClipboardPaste, Copy, CopyPlus, Crop, FlipHorizontal2, FlipVertical2, Group, Lock, PaintBucket, Paintbrush, Scissors, Trash2, Ungroup } from "lucide-react";
import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { StudioElement } from "@/types/studio";
import { canGroup, canUngroup, flipSelection, group, reorder, toggleLock, ungroup } from "./commands";
import { beginCrop, croppable } from "./cropMode";
import { copyStyle, pasteStyle, useStyleClipboard } from "./styleClipboard";
import { useStudioStore } from "./studioStore";

export function canvasMenuItems(t: TFunction, selection: string[], selected: StudioElement[]): ContextMenuItem[] {
  const state = useStudioStore.getState();
  return [
    { type: "item", id: "cut", label: t("studio.menu.cut"), icon: Scissors, shortcut: "Ctrl+X", disabled: !selection.length, onSelect: state.cut },
    { type: "item", id: "copy", label: t("studio.menu.copy"), icon: Copy, shortcut: "Ctrl+C", disabled: !selection.length, onSelect: state.copy },
    { type: "item", id: "paste", label: t("studio.menu.paste"), icon: ClipboardPaste, shortcut: "Ctrl+V", disabled: !state.clipboard?.length, onSelect: state.paste },
    { type: "item", id: "duplicate", label: t("studio.menu.duplicate"), icon: CopyPlus, shortcut: "Ctrl+D", disabled: !selection.length, onSelect: state.duplicate },
    { type: "item", id: "copyStyle", label: t("studio.menu.copyStyle"), icon: Paintbrush, shortcut: "Ctrl+Alt+C", disabled: !selection.length, onSelect: copyStyle },
    { type: "item", id: "pasteStyle", label: t("studio.menu.pasteStyle"), icon: PaintBucket, shortcut: "Ctrl+Alt+V", disabled: !selection.length || !useStyleClipboard.getState().style, onSelect: pasteStyle },
    { type: "separator", id: "s1" },
    { type: "item", id: "front", label: t("studio.menu.front"), icon: ArrowUpToLine, shortcut: "Ctrl+Shift+↑", disabled: !selection.length, onSelect: () => reorder("front") },
    { type: "item", id: "back", label: t("studio.menu.back"), icon: ArrowDownToLine, shortcut: "Ctrl+Shift+↓", disabled: !selection.length, onSelect: () => reorder("back") },
    { type: "item", id: "group", label: t("studio.menu.group"), icon: Group, shortcut: "Ctrl+G", disabled: !canGroup(), onSelect: group },
    { type: "item", id: "ungroup", label: t("studio.menu.ungroup"), icon: Ungroup, shortcut: "Ctrl+Shift+G", disabled: !canUngroup(), onSelect: ungroup },
    { type: "item", id: "lock", label: t("studio.menu.lock"), icon: Lock, checked: selected.length > 0 && selected.every((element) => element.locked), disabled: !selection.length, onSelect: toggleLock },
    { type: "item", id: "flipHorizontal", label: t("studio.flip.horizontal"), icon: FlipHorizontal2, shortcut: "Shift+H", disabled: !selected.some((element) => !element.locked), onSelect: () => flipSelection("horizontal") },
    { type: "item", id: "flipVertical", label: t("studio.flip.vertical"), icon: FlipVertical2, shortcut: "Shift+V", disabled: !selected.some((element) => !element.locked), onSelect: () => flipSelection("vertical") },
    ...(selected.length === 1 && croppable(selected[0]) ? [{ type: "item" as const, id: "crop", label: t("studio.crop.button"), icon: Crop, shortcut: "Enter", onSelect: () => void beginCrop(selected[0]) }] : []),
    { type: "separator", id: "s2" },
    { type: "item", id: "delete", label: t("studio.menu.delete"), icon: Trash2, shortcut: "Delete", disabled: !selection.length, onSelect: state.remove },
  ];
}

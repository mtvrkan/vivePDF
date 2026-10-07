import { useTranslation } from "react-i18next";
import {
  ArrowDownUp,
  ArrowLeftToLine,
  ArrowRightToLine,
  BookMarked,
  CheckSquare,
  ClipboardCopy,
  ClipboardPaste,
  ClipboardX,
  Compass,
  Copy,
  CopyPlus,
  CopyX,
  Eraser,
  FileImage,
  FileOutput,
  FilePlus2,
  FileText,
  FileX2,
  FlipHorizontal2,
  Keyboard,
  ListChecks,
  ListEnd,
  Loader2,
  MousePointerClick,
  PanelLeft,
  PanelRight,
  PencilRuler,
  Printer,
  Redo2,
  Replace,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Scissors,
  Square,
  Tag,
  TextCursorInput,
  ToggleRight,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/shared/Button";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { IconButton } from "@/components/shared/IconButton";
import { MenuButton } from "@/components/shared/MenuButton";
import { PAGES_ZOOM_MAX, PAGES_ZOOM_MIN, useUiStore } from "@/shared/store/uiStore";
import { cutStarts, tilesAtParity, useOrganizerStore } from "./organizerStore";
import { usePageClipboard } from "./pageClipboard";
import type { OrganizerEdits } from "./useOrganizerEdits";
import type { Inspection, PageInspections } from "./usePageInspections";

export type ToolbarCommands = {
  openRange: () => void;
  openDuplex: () => void;
  openLabels: () => void;
  openBlank: () => void;
  pickPdf: (replace: boolean) => void;
  pickImages: () => void;
  openShortcuts: () => void;
  extractSelection: () => void;
  pastePages: () => void;
  openCopies: () => void;
};

type OrganizerToolbarProps = {
  edits: OrganizerEdits;
  inspections: PageInspections;
  commands: ToolbarCommands;
  multiSelect: boolean;
  pasting: boolean;
  onToggleMultiSelect: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
};

function Divider() {
  return <span className="mx-1 h-4 w-px bg-border" aria-hidden />;
}

export function OrganizerToolbar({ edits, inspections, commands, multiSelect, pasting, onToggleMultiSelect, zoom, onZoom }: OrganizerToolbarProps) {
  const { t } = useTranslation();
  const tiles = useOrganizerStore((state) => state.tiles);
  const selectedCount = useOrganizerStore((state) => state.selected.size);
  const cutCount = useOrganizerStore((state) => cutStarts(state.tiles, state.cuts).length);
  const canUndo = useOrganizerStore((state) => state.past.length > 0);
  const canRedo = useOrganizerStore((state) => state.future.length > 0);
  const undo = useOrganizerStore((state) => state.undo);
  const redo = useOrganizerStore((state) => state.redo);
  const select = useOrganizerStore((state) => state.select);
  const canPaste = usePageClipboard((state) => state.tiles.length > 0);
  const insertPlace = useUiStore((state) => state.pagesInsertPlace);
  const setInsertPlace = useUiStore((state) => state.setPagesInsertPlace);
  const { inspecting, inspectionControl } = inspections;

  const inspectionItem = (kind: Inspection, id: string, label: string, icon: LucideIcon): ContextMenuItem => {
    const control = inspectionControl(kind);
    return { type: "item", id, label, icon, disabled: control.disabled || control.busy, onSelect: control.onClick };
  };

  const selectItems: ContextMenuItem[] = [
    { type: "item", id: "select-all", label: t("tools.pages.selectAll"), icon: CheckSquare, shortcut: "Ctrl+A", disabled: tiles.length === 0, onSelect: () => select(tiles.map((tile) => tile.key)) },
    { type: "item", id: "select-none", label: t("tools.pages.selectNone"), icon: Square, shortcut: "Esc", disabled: selectedCount === 0, onSelect: () => select([]) },
    { type: "item", id: "select-range", label: t("tools.pages.range.title"), icon: TextCursorInput, shortcut: "Ctrl+G", onSelect: commands.openRange },
    { type: "item", id: "select-invert", label: t("tools.pages.selectInvert"), icon: ToggleRight, shortcut: "Ctrl+I", disabled: tiles.length === 0, onSelect: edits.invertSelection },
    { type: "item", id: "select-odd", label: t("tools.pages.selectOdd"), icon: PanelRight, disabled: tiles.length === 0, onSelect: () => select(tilesAtParity(tiles, "odd")) },
    { type: "item", id: "select-even", label: t("tools.pages.selectEven"), icon: PanelLeft, disabled: tiles.length < 2, onSelect: () => select(tilesAtParity(tiles, "even")) },
    { type: "separator", id: "select-find" },
    inspectionItem("blank", "select-blank", t("tools.pages.selectBlank"), FileX2),
    inspectionItem("scanned", "select-scanned", t("tools.pages.selectScanned"), ScanSearch),
    inspectionItem("duplicates", "select-duplicates", t("tools.pages.duplicates.select"), CopyX),
  ];

  const insertItems: ContextMenuItem[] = [
    { type: "item", id: "insert-blank", label: t("tools.pages.insertBlank"), icon: FilePlus2, shortcut: "B", onSelect: commands.openBlank },
    { type: "item", id: "insert-pdf", label: t("tools.pages.insertPdf"), icon: FileText, onSelect: () => commands.pickPdf(false) },
    { type: "item", id: "insert-images", label: t("tools.pages.insertImages"), icon: FileImage, onSelect: commands.pickImages },
    { type: "item", id: "insert-paste", label: t("tools.pages.clipboard.paste"), icon: ClipboardPaste, shortcut: "Ctrl+V", disabled: !canPaste || pasting, onSelect: commands.pastePages },
    { type: "separator", id: "insert-place" },
    {
      type: "submenu",
      id: "insert-where",
      label: t("tools.pages.insertPlace.title"),
      icon: ListEnd,
      items: (["after", "before", "end"] as const).map((place) => ({ type: "item", id: `insert-place-${place}`, label: t(`tools.pages.insertPlace.${place}`), checked: insertPlace === place, onSelect: () => setInsertPlace(place) })),
    },
    { type: "separator", id: "insert-replace" },
    { type: "item", id: "replace-pdf", label: t("tools.pages.replacePdf"), icon: Replace, disabled: selectedCount === 0, onSelect: () => commands.pickPdf(true) },
  ];

  const editItems: ContextMenuItem[] = [
    { type: "item", id: "rotate-left", label: t("tools.pages.rotateLeft"), icon: RotateCcw, shortcut: "Shift+R", disabled: selectedCount === 0, onSelect: () => edits.rotateSelected(-90) },
    { type: "item", id: "rotate-right", label: t("tools.pages.rotateRight"), icon: RotateCw, shortcut: "R", disabled: selectedCount === 0, onSelect: () => edits.rotateSelected(90) },
    { type: "item", id: "duplicate", label: t("tools.pages.duplicate"), icon: Copy, shortcut: "Ctrl+D", disabled: selectedCount === 0, onSelect: edits.duplicateSelected },
    { type: "item", id: "duplicate-many", label: t("tools.pages.copies.menu"), icon: CopyPlus, disabled: selectedCount === 0, onSelect: commands.openCopies },
    { type: "item", id: "reverse-selection", label: t("tools.pages.reverseSelection"), icon: ArrowDownUp, disabled: selectedCount < 2, onSelect: edits.reverseSelected },
    { type: "item", id: "delete", label: t("tools.pages.delete"), icon: Trash2, shortcut: "Delete", disabled: selectedCount === 0 || selectedCount === tiles.length, onSelect: edits.deleteSelected },
    { type: "item", id: "delete-before", label: t("tools.pages.deleteBefore"), icon: ArrowLeftToLine, disabled: selectedCount !== 1, onSelect: () => edits.deleteRelative("before") },
    { type: "item", id: "delete-after", label: t("tools.pages.deleteAfter"), icon: ArrowRightToLine, disabled: selectedCount !== 1, onSelect: () => edits.deleteRelative("after") },
    { type: "separator", id: "edit-document" },
    { type: "item", id: "reverse", label: t("tools.pages.reverse"), icon: FlipHorizontal2, disabled: tiles.length < 2, onSelect: edits.reverseAll },
    inspectionItem("rotation", "auto-rotate", t("tools.pages.autoRotate"), Compass),
    { type: "item", id: "duplex", label: t("tools.pages.duplex.title"), icon: Printer, disabled: tiles.length < 2, onSelect: commands.openDuplex },
    { type: "item", id: "labels", label: t("tools.pages.labels.button"), icon: Tag, disabled: tiles.length === 0, onSelect: commands.openLabels },
  ];

  const splitItems: ContextMenuItem[] = [
    { type: "item", id: "cut-selection", label: t("tools.pages.cutAtSelection"), icon: Scissors, shortcut: "S", disabled: selectedCount === 0, onSelect: edits.toggleCutsAtSelection },
    inspectionItem("bookmarks", "cut-chapters", t("tools.pages.chapters.cut"), BookMarked),
    { type: "item", id: "clear-cuts", label: t("tools.pages.clearCuts"), icon: Eraser, shortcut: "Shift+S", disabled: cutCount === 0, onSelect: () => edits.setCuts(new Set()) },
  ];

  const running = inspecting ? inspectionControl(inspecting) : null;

  return (
    <div role="toolbar" aria-label={t("tools.pages.toolbar")} className="flex min-h-topbar flex-wrap items-center gap-1 glass-flat border-b px-2 py-1 [&>*]:shrink-0">
      <IconButton icon={Undo2} label={t("tools.pages.undo")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo} />
      <IconButton icon={Redo2} label={t("tools.pages.redo")} shortcut="Ctrl+Y" disabled={!canRedo} onClick={redo} />
      <Divider />
      <MenuButton icon={CheckSquare} label={t("tools.pages.groups.select")} items={selectItems} />
      <IconButton icon={ListChecks} label={t("tools.pages.multiSelectMode")} active={multiSelect} onClick={onToggleMultiSelect} />
      <MenuButton icon={FilePlus2} label={t("tools.pages.groups.insert")} items={insertItems} />
      <MenuButton icon={PencilRuler} label={t("tools.pages.groups.edit")} items={editItems} />
      <MenuButton icon={Scissors} label={t("tools.pages.groups.split")} items={splitItems} />
      {running ? (
        <Button size="sm" variant="ghost" aria-busy icon={<Loader2 className="size-4 animate-spin" aria-hidden />} onClick={running.onClick}>
          {t("tools.pages.inspecting")}
        </Button>
      ) : null}
      <span className="flex-1" />
      <IconButton icon={ZoomOut} label={t("viewer.zoomOut")} shortcut="Ctrl+-" disabled={zoom <= PAGES_ZOOM_MIN} onClick={() => onZoom(zoom - 30)} />
      <input
        type="range"
        min={PAGES_ZOOM_MIN}
        max={PAGES_ZOOM_MAX}
        step={10}
        value={zoom}
        onChange={(event) => onZoom(Number(event.target.value))}
        aria-label={t("tools.pages.thumbnailSize")}
        className="w-24 accent-primary"
      />
      <IconButton icon={ZoomIn} label={t("viewer.zoomIn")} shortcut="Ctrl++" disabled={zoom >= PAGES_ZOOM_MAX} onClick={() => onZoom(zoom + 30)} />
      <IconButton icon={Keyboard} label={t("tools.pages.shortcuts")} shortcut="?" onClick={commands.openShortcuts} />
    </div>
  );
}

type SelectionBarProps = {
  edits: OrganizerEdits;
  busy: boolean;
  onExtract: () => void;
  onCopy: () => void;
  onCut: () => void;
};

export function SelectionBar({ edits, busy, onExtract, onCopy, onCut }: SelectionBarProps) {
  const { t } = useTranslation();
  const tiles = useOrganizerStore((state) => state.tiles);
  const selectedCount = useOrganizerStore((state) => state.selected.size);
  const select = useOrganizerStore((state) => state.select);

  return (
    <div data-no-marquee className="pointer-events-none sticky bottom-0 z-30 mt-4 flex justify-center">
      {selectedCount > 0 ? (
        <div role="toolbar" aria-label={t("tools.pages.selectionBar")} className="glass glass-solid pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl px-2 py-1.5 shadow-(--shadow-float)">
          <span role="status" className="px-2 text-sm font-medium">
            {t("tools.pages.selectedCount", { count: selectedCount })}
          </span>
          <Divider />
          <IconButton icon={CheckSquare} label={t("tools.pages.selectAll")} shortcut="Ctrl+A" disabled={selectedCount === tiles.length} onClick={() => select(tiles.map((tile) => tile.key))} />
          <IconButton icon={RotateCcw} label={t("tools.pages.rotateLeft")} shortcut="Shift+R" onClick={() => edits.rotateSelected(-90)} />
          <IconButton icon={RotateCw} label={t("tools.pages.rotateRight")} shortcut="R" onClick={() => edits.rotateSelected(90)} />
          <IconButton icon={Copy} label={t("tools.pages.duplicate")} shortcut="Ctrl+D" onClick={edits.duplicateSelected} />
          <IconButton icon={ClipboardCopy} label={t("tools.pages.clipboard.copy")} shortcut="Ctrl+C" onClick={onCopy} />
          <IconButton icon={ClipboardX} label={t("tools.pages.clipboard.cut")} shortcut="Ctrl+X" disabled={selectedCount === tiles.length} onClick={onCut} />
          <IconButton icon={Scissors} label={t("tools.pages.cutAtSelection")} shortcut="S" onClick={edits.toggleCutsAtSelection} />
          <IconButton icon={FileOutput} label={t("tools.pages.shortcut.extract")} shortcut="Ctrl+E" disabled={busy} onClick={onExtract} />
          <IconButton icon={Trash2} label={t("tools.pages.delete")} shortcut="Delete" disabled={selectedCount === tiles.length} onClick={edits.deleteSelected} />
          <Divider />
          <IconButton icon={X} label={t("tools.pages.selectNone")} shortcut="Esc" onClick={() => select([])} />
        </div>
      ) : (
        <p className="glass glass-solid pointer-events-auto flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-muted-foreground">
          <MousePointerClick className="size-4 shrink-0" aria-hidden />
          {t("tools.pages.selectHint")}
        </p>
      )}
    </div>
  );
}

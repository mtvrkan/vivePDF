import { useTranslation } from "react-i18next";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  BookMarked,
  CheckSquare,
  ClipboardCopy,
  ClipboardPaste,
  ClipboardX,
  Compass,
  Copy,
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
  MousePointerClick,
  PanelLeft,
  PanelRight,
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
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { IconButton } from "@/components/shared/IconButton";
import { PAGES_ZOOM_MAX, PAGES_ZOOM_MIN } from "@/shared/store/uiStore";
import { tilesAtParity, useOrganizerStore } from "./organizerStore";
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
  const cutCount = useOrganizerStore((state) => state.cuts.size);
  const canUndo = useOrganizerStore((state) => state.past.length > 0);
  const canRedo = useOrganizerStore((state) => state.future.length > 0);
  const undo = useOrganizerStore((state) => state.undo);
  const redo = useOrganizerStore((state) => state.redo);
  const select = useOrganizerStore((state) => state.select);
  const canPaste = usePageClipboard((state) => state.tiles.length > 0);
  const { inspecting, inspectionControl } = inspections;
  const inspectionLabel = (kind: Inspection, idle: string) => (inspecting === kind ? t("tools.pages.inspecting") : t(idle));

  return (
    <div className="flex min-h-topbar flex-wrap items-center gap-1 glass-flat border-b px-2 py-1 [&>*]:shrink-0">
      <IconButton icon={Undo2} label={t("tools.pages.undo")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo} />
      <IconButton icon={Redo2} label={t("tools.pages.redo")} shortcut="Ctrl+Y" disabled={!canRedo} onClick={redo} />
      <Divider />
      <IconButton icon={ListChecks} label={t("tools.pages.multiSelectMode")} active={multiSelect} onClick={onToggleMultiSelect} />
      <IconButton icon={CheckSquare} label={t("tools.pages.selectAll")} shortcut="Ctrl+A" onClick={() => select(tiles.map((tile) => tile.key))} />
      <IconButton icon={Square} label={t("tools.pages.selectNone")} shortcut="Esc" onClick={() => select([])} />
      <IconButton icon={TextCursorInput} label={t("tools.pages.range.title")} shortcut="Ctrl+G" onClick={commands.openRange} />
      <IconButton icon={PanelRight} label={t("tools.pages.selectOdd")} disabled={tiles.length === 0} onClick={() => select(tilesAtParity(tiles, "odd"))} />
      <IconButton icon={PanelLeft} label={t("tools.pages.selectEven")} disabled={tiles.length < 2} onClick={() => select(tilesAtParity(tiles, "even"))} />
      <IconButton icon={FileX2} label={inspectionLabel("blank", "tools.pages.selectBlank")} {...inspectionControl("blank")} />
      <IconButton icon={ScanSearch} label={inspectionLabel("scanned", "tools.pages.selectScanned")} {...inspectionControl("scanned")} />
      <IconButton icon={CopyX} label={inspectionLabel("duplicates", "tools.pages.duplicates.select")} {...inspectionControl("duplicates")} />
      <IconButton icon={Compass} label={inspectionLabel("rotation", "tools.pages.autoRotate")} {...inspectionControl("rotation")} />
      <Divider />
      <IconButton icon={RotateCcw} label={t("tools.pages.rotateLeft")} shortcut="Shift+R" disabled={selectedCount === 0} onClick={() => edits.rotateSelected(-90)} />
      <IconButton icon={RotateCw} label={t("tools.pages.rotateRight")} shortcut="R" disabled={selectedCount === 0} onClick={() => edits.rotateSelected(90)} />
      <IconButton icon={Copy} label={t("tools.pages.duplicate")} shortcut="Ctrl+D" disabled={selectedCount === 0} onClick={edits.duplicateSelected} />
      <IconButton icon={Trash2} label={t("tools.pages.delete")} shortcut="Delete" disabled={selectedCount === 0 || selectedCount === tiles.length} onClick={edits.deleteSelected} />
      <IconButton icon={ArrowLeftToLine} label={t("tools.pages.deleteBefore")} disabled={selectedCount !== 1} onClick={() => edits.deleteRelative("before")} />
      <IconButton icon={ArrowRightToLine} label={t("tools.pages.deleteAfter")} disabled={selectedCount !== 1} onClick={() => edits.deleteRelative("after")} />
      <IconButton icon={FlipHorizontal2} label={t("tools.pages.reverse")} onClick={edits.reverseAll} />
      <IconButton icon={ClipboardPaste} label={t("tools.pages.clipboard.paste")} shortcut="Ctrl+V" disabled={!canPaste || pasting} onClick={commands.pastePages} />
      <Divider />
      <IconButton icon={Scissors} label={t("tools.pages.cutAtSelection")} shortcut="S" disabled={selectedCount === 0} onClick={edits.toggleCutsAtSelection} />
      <IconButton icon={BookMarked} label={inspectionLabel("bookmarks", "tools.pages.chapters.cut")} {...inspectionControl("bookmarks")} />
      <IconButton icon={Eraser} label={t("tools.pages.clearCuts")} shortcut="Shift+S" disabled={cutCount === 0} onClick={() => edits.setCuts(new Set())} />
      <IconButton icon={Printer} label={t("tools.pages.duplex.title")} disabled={tiles.length < 2} onClick={commands.openDuplex} />
      <IconButton icon={Tag} label={t("tools.pages.labels.button")} disabled={tiles.length === 0} onClick={commands.openLabels} />
      <Divider />
      <IconButton icon={FilePlus2} label={t("tools.pages.insertBlank")} shortcut="B" onClick={commands.openBlank} />
      <IconButton icon={FileText} label={t("tools.pages.insertPdf")} onClick={() => commands.pickPdf(false)} />
      <IconButton icon={Replace} label={t("tools.pages.replacePdf")} disabled={selectedCount === 0} onClick={() => commands.pickPdf(true)} />
      <IconButton icon={FileImage} label={t("tools.pages.insertImages")} onClick={commands.pickImages} />
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
        <div role="toolbar" aria-label={t("tools.pages.selectionBar")} className="glass pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl px-2 py-1.5 shadow-(--shadow-float)">
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
        <p className="glass pointer-events-auto flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-muted-foreground">
          <MousePointerClick className="size-4 shrink-0" aria-hidden />
          {t("tools.pages.selectHint")}
        </p>
      )}
    </div>
  );
}

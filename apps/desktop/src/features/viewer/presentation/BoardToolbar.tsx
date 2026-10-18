import { useEffect, useId, useState } from "react";
import { BrushCleaning, Eraser, Highlighter, MousePointerClick, PenLine, Redo2, Shapes, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore, type BoardMode, type PresentationTool } from "@/shared/store/presentationStore";
import { BOARD_HIGHLIGHTER_SWATCHES, BOARD_PEN_SWATCHES, BOARD_SIZES, boardSizeOf, boardSizePatch, boardStyleTool, clampBoardSize, type BoardStyleTool, type BoardSwatch } from "./boardPresets";

const BOARD_TOOLS: Array<{ id: Extract<PresentationTool, "select" | "pen" | "highlighter" | "shape" | "eraser">; icon: LucideIcon; labelKey: string; shortcut?: string }> = [
  { id: "select", icon: MousePointerClick, labelKey: "presentation.tools.select", shortcut: "V" },
  { id: "pen", icon: PenLine, labelKey: "presentation.tools.pen", shortcut: "P" },
  { id: "highlighter", icon: Highlighter, labelKey: "presentation.tools.highlighter", shortcut: "H" },
  { id: "shape", icon: Shapes, labelKey: "presentation.tools.shape" },
  { id: "eraser", icon: Eraser, labelKey: "presentation.tools.eraser", shortcut: "E" },
];

const MAX_DOT_PX = 20;

function sizeLabelKey(tool: BoardStyleTool) {
  return tool === "eraser" ? "presentation.board.eraserSize" : "presentation.thickness";
}

function SizeDot({ size, tool }: { size: number; tool: BoardStyleTool }) {
  const scale = MAX_DOT_PX / BOARD_SIZES[tool].max;
  const diameter = Math.max(3, Math.round(size * scale));
  return <span aria-hidden className={cn("block rounded-full", tool === "eraser" ? "border border-current" : "bg-current")} style={{ width: Math.min(MAX_DOT_PX, diameter), height: Math.min(MAX_DOT_PX, diameter) }} />;
}

function Swatches({ swatches, current, onPick }: { swatches: BoardSwatch[]; current: string; onPick: (color: string) => void }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("presentation.board.color")} className="flex items-center gap-1">
      {swatches.map((swatch) => {
        const active = swatch.color.toLowerCase() === current.toLowerCase();
        return (
          <button
            key={swatch.color}
            type="button"
            aria-label={t(swatch.nameKey)}
            title={t(swatch.nameKey)}
            aria-pressed={active}
            data-board-swatch={swatch.color}
            onClick={() => onPick(swatch.color)}
            className={cn("size-6 rounded-full border border-border transition-transform duration-(--transition-fast) hover:scale-110", active && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
            style={{ backgroundColor: swatch.color }}
          />
        );
      })}
    </div>
  );
}

function SizePanel({ tool, value, onChange }: { tool: BoardStyleTool; value: number; onChange: (size: number) => void }) {
  const { t } = useTranslation();
  const sliderId = useId();
  const range = BOARD_SIZES[tool];
  return (
    <div className="glass select-pop pointer-events-auto absolute start-1/2 top-full mt-2 w-64 -translate-x-1/2 rounded-2xl p-3 rtl:translate-x-1/2">
      <p className="mb-1.5 text-xs text-muted-foreground">{t(sizeLabelKey(tool))}</p>
      <div role="group" aria-label={t("presentation.board.sizePresets")} className="flex items-center gap-1">
        {range.presets.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={t("presentation.board.sizeValue", { value: preset })}
            title={t("presentation.board.sizeValue", { value: preset })}
            aria-pressed={value === preset}
            onClick={() => onChange(preset)}
            className={cn("flex size-8 items-center justify-center rounded-lg", value === preset ? "glass-chip text-primary" : "nav-glass text-foreground/80")}
          >
            <SizeDot size={preset} tool={tool} />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={sliderId}
          type="range"
          min={range.min}
          max={range.max}
          value={value}
          onChange={(event) => onChange(clampBoardSize(tool, Number(event.target.value)))}
          aria-label={t(sizeLabelKey(tool))}
          aria-valuetext={t("presentation.board.sizeValue", { value })}
          className="min-w-0 flex-1 accent-primary"
        />
        <output htmlFor={sliderId} className="w-8 text-end font-mono text-xs tabular-nums text-muted-foreground">
          {value}
        </output>
      </div>
    </div>
  );
}

export function BoardToolbar({ board, selectedCount, dimmed, onDeleteSelection, onRequestClear }: { board: BoardMode; selectedCount: number; dimmed: boolean; onDeleteSelection: () => void; onRequestClear: () => void }) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const setTool = usePresentationStore((state) => state.setTool);
  const pen = usePresentationStore((state) => state.boardPens[board]);
  const setBoardPen = usePresentationStore((state) => state.setBoardPen);
  const canUndo = usePresentationStore((state) => state.boardHistory[board].undo.length > 0);
  const canRedo = usePresentationStore((state) => state.boardHistory[board].redo.length > 0);
  const strokeCount = usePresentationStore((state) => state.boardStrokes[board].length);
  const [sizeOpen, setSizeOpen] = useState(false);
  const styleTool = boardStyleTool(tool);

  useEffect(() => {
    if (!styleTool) setSizeOpen(false);
  }, [styleTool]);

  const swatches = tool === "pen" || tool === "shape" ? BOARD_PEN_SWATCHES[board] : tool === "highlighter" ? BOARD_HIGHLIGHTER_SWATCHES[board] : null;
  const currentColor = tool === "highlighter" ? pen.highlighterColor : pen.penColor;
  const pickColor = (color: string) => setBoardPen(board, tool === "highlighter" ? { highlighterColor: color } : { penColor: color });

  return (
    <div
      role="group"
      aria-label={t("presentation.board.toolbar")}
      data-board-toolbar
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn("glass pointer-events-auto absolute inset-x-0 top-4 z-40 mx-auto flex h-11 w-fit items-center gap-1 rounded-full px-2 transition-opacity duration-(--transition-base)", dimmed && "opacity-40")}
    >
      {BOARD_TOOLS.map((entry) => (
        <IconButton key={entry.id} icon={entry.icon} label={t(entry.labelKey)} shortcut={entry.shortcut} active={tool === entry.id} onClick={() => setTool(tool === entry.id ? "pointer" : entry.id)} />
      ))}
      {swatches || styleTool ? <span className="mx-1 h-5 w-px bg-border" aria-hidden /> : null}
      {swatches ? <Swatches swatches={swatches} current={currentColor} onPick={pickColor} /> : null}
      {styleTool ? (
        <div className="relative">
          <button
            type="button"
            aria-label={t(sizeLabelKey(styleTool))}
            title={t(sizeLabelKey(styleTool))}
            aria-expanded={sizeOpen}
            aria-keyshortcuts="[ ]"
            onClick={() => setSizeOpen((open) => !open)}
            className={cn("nav-glass inline-flex size-8 items-center justify-center rounded-lg text-foreground/80", sizeOpen && "glass-chip text-primary")}
          >
            <SizeDot size={boardSizeOf(pen, styleTool)} tool={styleTool} />
          </button>
          {sizeOpen ? <SizePanel tool={styleTool} value={boardSizeOf(pen, styleTool)} onChange={(size) => setBoardPen(board, boardSizePatch(styleTool, size))} /> : null}
        </div>
      ) : null}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <IconButton icon={Undo2} label={t("common.undo")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => usePresentationStore.getState().undoBoard(board)} />
      <IconButton icon={Redo2} label={t("presentation.board.redo")} shortcut="Ctrl+Y" disabled={!canRedo} onClick={() => usePresentationStore.getState().redoBoard(board)} />
      <IconButton icon={Trash2} label={t("presentation.board.deleteSelected", { count: selectedCount })} shortcut="Del" disabled={selectedCount === 0} onClick={onDeleteSelection} />
      <IconButton icon={BrushCleaning} label={t("presentation.board.clear")} disabled={strokeCount === 0} onClick={onRequestClear} />
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <IconButton icon={X} label={t("presentation.board.backToSlides")} shortcut="Esc" onClick={() => usePresentationStore.getState().setBlackout("none")} />
    </div>
  );
}

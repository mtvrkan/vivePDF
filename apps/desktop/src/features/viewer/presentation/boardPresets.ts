import { ERASER_SIZE_RANGE, HIGHLIGHTER_WIDTH_RANGE, PEN_WIDTH_RANGE, type BoardMode, type BoardPen, type PresentationTool } from "@/shared/store/presentationStore";

export type BoardSwatch = { color: string; nameKey: string };
export type BoardSizeRange = { min: number; max: number; presets: readonly number[] };
export type BoardStyleTool = "pen" | "highlighter" | "eraser";

const swatch = (color: string, name: string): BoardSwatch => ({ color, nameKey: `presentation.board.colors.${name}` });

export const BOARD_PEN_SWATCHES: Record<BoardMode, BoardSwatch[]> = {
  black: [
    swatch("#FFFFFF", "white"),
    swatch("#FFD400", "yellow"),
    swatch("#22D3EE", "cyan"),
    swatch("#4ADE80", "green"),
    swatch("#F472B6", "pink"),
    swatch("#F87171", "red"),
    swatch("#FB923C", "orange"),
    swatch("#A78BFA", "purple"),
  ],
  white: [
    swatch("#111827", "black"),
    swatch("#2563EB", "blue"),
    swatch("#DC2626", "red"),
    swatch("#16A34A", "green"),
    swatch("#EA580C", "orange"),
    swatch("#7C3AED", "purple"),
    swatch("#DB2777", "pink"),
    swatch("#6B7280", "gray"),
  ],
};

export const BOARD_HIGHLIGHTER_SWATCHES: Record<BoardMode, BoardSwatch[]> = {
  black: [swatch("#FFD400", "yellow"), swatch("#22D3EE", "cyan"), swatch("#4ADE80", "green"), swatch("#F472B6", "pink"), swatch("#FB923C", "orange")],
  white: [swatch("#FFD400", "yellow"), swatch("#86EFAC", "green"), swatch("#67E8F9", "cyan"), swatch("#F9A8D4", "pink"), swatch("#FDBA74", "orange")],
};

export const BOARD_SIZES: Record<BoardStyleTool, BoardSizeRange> = {
  pen: { min: PEN_WIDTH_RANGE[0], max: PEN_WIDTH_RANGE[1], presets: [2, 4, 6, 10, 16] },
  highlighter: { min: HIGHLIGHTER_WIDTH_RANGE[0], max: HIGHLIGHTER_WIDTH_RANGE[1], presets: [12, 18, 24, 36] },
  eraser: { min: ERASER_SIZE_RANGE[0], max: ERASER_SIZE_RANGE[1], presets: [24, 48, 96, 160] },
};

const SIZE_KEYS = { pen: "penWidth", highlighter: "highlighterWidth", eraser: "eraserSize" } as const satisfies Record<BoardStyleTool, keyof BoardPen>;

export function boardStyleTool(tool: PresentationTool): BoardStyleTool | null {
  if (tool === "pen" || tool === "shape") return "pen";
  if (tool === "highlighter" || tool === "eraser") return tool;
  return null;
}

export function boardSizeOf(pen: BoardPen, tool: BoardStyleTool): number {
  return pen[SIZE_KEYS[tool]];
}

export function boardSizePatch(tool: BoardStyleTool, size: number): Partial<BoardPen> {
  return { [SIZE_KEYS[tool]]: size };
}

export function clampBoardSize(tool: BoardStyleTool, size: number): number {
  const range = BOARD_SIZES[tool];
  return Math.round(Math.min(range.max, Math.max(range.min, size)));
}

export function stepBoardSize(tool: BoardStyleTool, current: number, direction: 1 | -1): number {
  const presets = BOARD_SIZES[tool].presets;
  if (direction > 0) return presets.find((value) => value > current) ?? Math.max(current, presets[presets.length - 1]);
  return [...presets].reverse().find((value) => value < current) ?? Math.min(current, presets[0]);
}

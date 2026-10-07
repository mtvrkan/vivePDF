import { Circle, Eraser, Highlighter, Minus, MousePointer2, MousePointerClick, MoveUpRight, PenLine, Search, Shapes, Sparkles, Square, Sun, Type } from "lucide-react";
import type { PresentationTool, ShapeKind } from "@/shared/store/presentationStore";

export const LASER_COLORS = ["#E5484D", "#30A46C", "#3E63DD", "#FFD400"];
export const PEN_COLORS = ["#E5484D", "#FF6B00", "#FFD400", "#30A46C", "#12A594", "#3E63DD", "#8E4EC6", "#E93D82", "#A1662F", "#8B8D98", "#FFFFFF", "#000000"];
export const LASER_SIZES = [6, 8, 12, 16];
export const SPOTLIGHT_SIZES = [110, 180, 260, 340];
export const SPOTLIGHT_DIMS = [0.5, 0.65, 0.78, 0.9];
export const MAGNIFIER_SIZES = [160, 220, 300, 380];
export const MAGNIFIER_ZOOMS = [1.5, 2, 2.5, 3, 4];

export const SHAPE_KINDS: Array<{ id: ShapeKind; icon: typeof Square; labelKey: string }> = [
  { id: "line", icon: Minus, labelKey: "presentation.shapes.line" },
  { id: "arrow", icon: MoveUpRight, labelKey: "presentation.shapes.arrow" },
  { id: "rect", icon: Square, labelKey: "presentation.shapes.rect" },
  { id: "ellipse", icon: Circle, labelKey: "presentation.shapes.ellipse" },
];

export const PRESENTATION_TOOLS: Array<{ id: PresentationTool; icon: typeof MousePointer2; labelKey: string }> = [
  { id: "pointer", icon: MousePointer2, labelKey: "presentation.tools.pointer" },
  { id: "laser", icon: Sparkles, labelKey: "presentation.tools.laser" },
  { id: "pen", icon: PenLine, labelKey: "presentation.tools.pen" },
  { id: "highlighter", icon: Highlighter, labelKey: "presentation.tools.highlighter" },
  { id: "shape", icon: Shapes, labelKey: "presentation.tools.shape" },
  { id: "text", icon: Type, labelKey: "presentation.tools.text" },
  { id: "select", icon: MousePointerClick, labelKey: "presentation.tools.select" },
  { id: "eraser", icon: Eraser, labelKey: "presentation.tools.eraser" },
  { id: "spotlight", icon: Sun, labelKey: "presentation.tools.spotlight" },
  { id: "magnifier", icon: Search, labelKey: "presentation.tools.magnifier" },
];

export function hasStyleOptions(tool: PresentationTool): boolean {
  return tool !== "pointer" && tool !== "eraser" && tool !== "select";
}

export function usesInkColor(tool: PresentationTool): boolean {
  return tool === "pen" || tool === "highlighter" || tool === "shape" || tool === "text";
}

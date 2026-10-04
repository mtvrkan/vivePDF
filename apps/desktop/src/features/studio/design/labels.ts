import { ChartColumn, Circle, Diamond, FileCode2, Heart, Hexagon, Image as ImageIcon, Minus, MoveRight, Octagon, PenTool, Pentagon, QrCode, Sigma, Square, Star, Table2, Triangle, Type, Workflow, type LucideIcon } from "lucide-react";
import type { StudioElement, StudioShapeKind, StudioSvgSource } from "@/types/studio";
import { textOf } from "../model/design";

export function elementLabel(element: StudioElement, t: (key: string) => string): string {
  if (element.name) return element.name;
  if (element.kind === "text") return textOf(element.runs).trim().slice(0, 40) || t("studio.kinds.text");
  if (element.kind === "shape") return t(`studio.shapes.${element.shape}`);
  return t(`studio.kinds.${element.kind}`);
}

const SHAPE_ICONS: Partial<Record<StudioShapeKind, LucideIcon>> = {
  ellipse: Circle,
  triangle: Triangle,
  rightTriangle: Triangle,
  diamond: Diamond,
  pentagon: Pentagon,
  hexagon: Hexagon,
  octagon: Octagon,
  star: Star,
  burst: Star,
  heart: Heart,
  line: Minus,
  arrowLine: MoveRight,
  arrow: MoveRight,
};

const SVG_ICONS: Record<StudioSvgSource, LucideIcon> = { table: Table2, chart: ChartColumn, formula: Sigma, flowchart: Workflow, import: FileCode2 };

export function kindIcon(element: StudioElement): LucideIcon {
  switch (element.kind) {
    case "text":
      return Type;
    case "shape":
      return SHAPE_ICONS[element.shape] ?? Square;
    case "image":
      return ImageIcon;
    case "qr":
      return QrCode;
    case "vector":
      return PenTool;
    default:
      return SVG_ICONS[element.source];
  }
}

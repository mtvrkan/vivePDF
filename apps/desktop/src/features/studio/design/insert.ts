import { STUDIO_SHAPES, type StudioElement, type StudioPage, type StudioShapeElement, type StudioShapeKind } from "@/types/studio";
import { createShape, createText } from "../model/design";
import { isLineShape } from "../model/shapes";
import { addElements } from "../model/edit";
import { useStudioStore } from "./studioStore";

export const TEXT_PRESETS = [
  { key: "heading", fontSize: 44, bold: true },
  { key: "subheading", fontSize: 26, bold: true },
  { key: "body", fontSize: 14, bold: false },
] as const;

export type TextPreset = (typeof TEXT_PRESETS)[number];

const CASCADE = 16;
const MAX_CASCADE = 20;

export function insert(element: StudioElement, cascade = true) {
  const store = useStudioStore.getState();
  store.applyToPage((page) => {
    let placed = element;
    for (let step = 0; cascade && step < MAX_CASCADE && page.elements.some((other) => Math.abs(other.x - placed.x) < 1 && Math.abs(other.y - placed.y) < 1); step += 1) {
      placed = { ...placed, x: placed.x + CASCADE, y: placed.y + CASCADE };
    }
    return addElements(page, [placed]);
  });
  store.select([element.id]);
}

export function centred(page: StudioPage, width: number, height: number) {
  return { x: (page.width - width) / 2, y: (page.height - height) / 2 };
}

export function insertText(page: StudioPage, preset: TextPreset, text: string) {
  const width = Math.min(page.width * 0.7, preset.fontSize * 14);
  const height = Math.ceil(preset.fontSize * 1.3);
  const at = centred(page, width, height);
  insert(createText(at.x, at.y, width, height, text, { fontSize: preset.fontSize, bold: preset.bold, align: "center" }));
}

export type ShapePreset = { key: string; shape: StudioShapeKind; overrides?: (side: number) => Partial<StudioShapeElement> };

export const ARROW_PRESET: ShapePreset = { key: "arrowLine", shape: "line", overrides: () => ({ endArrow: "arrow" }) };

export const SHAPE_PRESETS: ShapePreset[] = STUDIO_SHAPES.flatMap((shape): ShapePreset[] => {
  if (shape === "rect") return [{ key: "rect", shape }, { key: "roundedRect", shape, overrides: (side) => ({ cornerRadius: Math.round(side * 0.15) }) }];
  if (shape === "arrowLine") return [ARROW_PRESET, { key: "doubleArrow", shape: "line", overrides: () => ({ startArrow: "arrow", endArrow: "arrow" }) }];
  return [{ key: shape, shape }];
});

export function presetShape(preset: ShapePreset, x: number, y: number, side: number, height: number, overrides: Partial<StudioShapeElement> = {}): StudioShapeElement {
  return createShape(preset.shape, x, y, side, height, { ...preset.overrides?.(side), ...overrides });
}

export function insertShape(page: StudioPage, shape: StudioShapeKind | ShapePreset) {
  const preset = typeof shape === "string" ? { key: shape, shape } : shape;
  const side = Math.min(page.width, page.height) * 0.25;
  const height = isLineShape(preset.shape) ? 16 : side;
  const at = centred(page, side, height);
  insert(presetShape(preset, at.x, at.y, side, height));
}

import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { dirnameOf, extensionOf, joinPath } from "@/shared/lib/paths";
import { drawingImage } from "@/shared/rpc/operations";
import type { DrawingImageFormat } from "@/types";
import { drawingLayerLabel } from "./drawingKinds";
import { drawingSvg, type DrawingImage } from "./drawingSource";

export const DRAWING_IMAGE_FORMATS: readonly DrawingImageFormat[] = ["png", "svg"];
export const DRAWING_IMAGE_SCALES = [1, 2, 4] as const;
export type DrawingImageScale = (typeof DRAWING_IMAGE_SCALES)[number];
export const DEFAULT_DRAWING_SCALE: DrawingImageScale = 2;

const PIXELS_PER_POINT = 4 / 3;
const MAX_PIXEL_SIDE = 12000;
const MAX_PIXELS = 80_000_000;
const MAX_NAME_CHARS = 60;
const UNSAFE_NAME = /[\\/:*?"<>|\p{Cc}]+/gu;

export function drawingPixelSize(width: number, height: number, scale: number): { width: number; height: number } {
  const wide = width * PIXELS_PER_POINT * scale;
  const tall = height * PIXELS_PER_POINT * scale;
  const shrink = Math.min(1, MAX_PIXEL_SIDE / Math.max(wide, tall), Math.sqrt(MAX_PIXELS / (wide * tall)));
  return { width: Math.max(1, Math.round(wide * shrink)), height: Math.max(1, Math.round(tall * shrink)) };
}

export function drawingFileName(item: DrawingImage, t: TFunction): string {
  const label = drawingLayerLabel(item.drawing, t).replace(UNSAFE_NAME, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS).trim();
  return label.replace(/\.+$/, "").trim() || t("viewer.drawingImage.fallbackName");
}

function formatOfPath(path: string, fallback: DrawingImageFormat): DrawingImageFormat {
  const extension = extensionOf(path);
  return DRAWING_IMAGE_FORMATS.includes(extension as DrawingImageFormat) ? (extension as DrawingImageFormat) : fallback;
}

function imageRequest(item: DrawingImage) {
  return { svg: drawingSvg(item.drawing), width: item.width, height: item.height };
}

export async function saveDrawingImage(options: { item: DrawingImage; format: DrawingImageFormat; scale: number; documentPath: string | null; t: TFunction }): Promise<string | null> {
  const { item, format, scale, documentPath, t } = options;
  const name = `${drawingFileName(item, t)}.${format}`;
  const filters = [
    { name: "PNG", extensions: ["png"] },
    { name: "SVG", extensions: ["svg"] },
  ];
  const chosen = await saveDialog({ defaultPath: documentPath ? joinPath(dirnameOf(documentPath), name) : name, filters: format === "svg" ? [...filters].reverse() : filters });
  if (!chosen) return null;
  const result = await drawingImage({ ...imageRequest(item), format: formatOfPath(chosen, format), scale, output: chosen, overwrite: true });
  return result.output;
}

export async function copyDrawingImage(item: DrawingImage, scale: number = DEFAULT_DRAWING_SCALE): Promise<void> {
  const result = await drawingImage({ ...imageRequest(item), format: "png", scale });
  const binary = atob(result.pngBase64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
}

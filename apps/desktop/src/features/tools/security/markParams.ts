import type { StampForm } from "@/features/tools/security/StampSection";
import type { WatermarkForm } from "@/features/tools/security/WatermarkSection";
import type { StampPreviewParams, WatermarkPreviewParams } from "@/types";

export type MarkSource = { path: string; password?: string };

export function typedSize(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function watermarkMarkParams(form: WatermarkForm, source: MarkSource): WatermarkPreviewParams {
  const { kind } = form;
  return {
    path: source.path,
    password: source.password,
    kind,
    text: kind === "text" ? form.text : undefined,
    imagePath: kind === "image" ? form.imagePath : undefined,
    templatePath: kind === "pdf" ? form.templatePath : undefined,
    templatePage: kind === "pdf" ? form.templatePage : undefined,
    fontSize: typedSize(form.fontSize, 4, 400, 48),
    bold: form.bold,
    color: form.color,
    fontId: form.fontId,
    opacity: form.opacity / 100,
    rotation: form.rotation,
    position: form.position,
    tileGap: form.tileGap,
    offsetX: form.offsetX,
    offsetY: form.offsetY,
    behind: form.behind,
    scale: form.scale / 100,
    pages: form.pages.trim() || undefined,
    side: form.side,
  };
}

export function watermarkHasContent(form: WatermarkForm): boolean {
  if (form.kind === "text") return form.text.trim().length > 0;
  if (form.kind === "image") return form.imagePath.length > 0;
  return form.templatePath.length > 0;
}

export function stampMarkParams(form: StampForm, source: MarkSource): StampPreviewParams {
  return {
    path: source.path,
    password: source.password,
    text: form.stampText.trim(),
    name: form.stampName.trim(),
    fontSize: typedSize(form.stampSize, 6, 200, 28),
    color: form.stampColor,
    fontId: form.stampFontId,
    behind: form.stampBehind,
    offsetX: form.stampOffsetX,
    offsetY: form.stampOffsetY,
    position: form.stampPosition,
    rotation: form.stampRotation,
    opacity: form.stampOpacity / 100,
    border: form.stampBorder,
    dateFormat: form.stampDateFormat,
    pages: form.stampPages.trim() || undefined,
    side: form.stampSide,
  };
}

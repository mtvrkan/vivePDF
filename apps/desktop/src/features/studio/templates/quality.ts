import type { StudioDesign, StudioElement, StudioPage, StudioTextElement } from "@/types/studio";
import { averageColor, blend, contrastRatio } from "./contrast";

export type QualityIssue = { page: number; kind: "contrast" | "overlap" | "fonts" | "fit"; detail: string };

export const MAX_FONT_FAMILIES = 3;
export const BODY_CONTRAST = 4.5;
export const LARGE_CONTRAST = 3;

type Point = [number, number];

function local(element: StudioElement, [x, y]: Point): Point {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const angle = (-element.rotation * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [dx * Math.cos(angle) - dy * Math.sin(angle), dx * Math.sin(angle) + dy * Math.cos(angle)];
}

function covers(element: StudioElement, point: Point): boolean {
  const [x, y] = local(element, point);
  const halfWidth = element.width / 2;
  const halfHeight = element.height / 2;
  if (element.kind === "shape" && element.shape === "ellipse") return (x * x) / (halfWidth * halfWidth) + (y * y) / (halfHeight * halfHeight) <= 1;
  return Math.abs(x) <= halfWidth && Math.abs(y) <= halfHeight;
}

function textOf(element: StudioTextElement): string {
  return element.runs.map((run) => run.text).join("");
}

function isLarge(element: StudioTextElement): boolean {
  return element.fontSize >= 24 || (element.bold && element.fontSize >= 18.5);
}

export function backdropAt(page: StudioPage, below: number, point: Point): string | null {
  if (page.background.image) return null;
  let color = averageColor(page.background.fill) ?? "#ffffff";
  for (let index = 0; index < below; index += 1) {
    const element = page.elements[index];
    if (element.hidden || !covers(element, point)) continue;
    if (element.kind === "image") return null;
    if (element.kind !== "shape" || element.shape === "line" || element.shape === "arrowLine") continue;
    const fill = averageColor(element.fill);
    if (fill) color = blend(fill, color, element.opacity);
  }
  return color;
}

function textColors(element: StudioTextElement): string[] {
  const colors = new Set<string>();
  for (const run of element.runs) if (run.text.trim()) colors.add(run.color ?? element.color);
  return [...colors];
}

function contrastIssues(page: StudioPage, pageIndex: number): QualityIssue[] {
  const issues: QualityIssue[] = [];
  page.elements.forEach((element, index) => {
    if (element.kind !== "text" || element.hidden || element.opacity < 0.6 || !textOf(element).trim()) return;
    const centre: Point = [element.x + element.width / 2, element.y + element.height / 2];
    const backdrop = backdropAt(page, index, centre);
    if (!backdrop) return;
    const needed = isLarge(element) ? LARGE_CONTRAST : BODY_CONTRAST;
    for (const color of textColors(element)) {
      const ratio = contrastRatio(blend(color, backdrop, element.opacity), backdrop);
      if (ratio < needed) issues.push({ page: pageIndex, kind: "contrast", detail: `"${textOf(element).slice(0, 30)}" ${color} on ${backdrop} = ${ratio.toFixed(2)}` });
    }
  });
  return issues;
}

type Box = { x: number; y: number; width: number; height: number };

const GLYPH_WIDTH = 0.52;

export function inkBox(element: StudioTextElement): Box {
  const content = textOf(element);
  const lines = content.split("\n");
  const average = element.fontSize * GLYPH_WIDTH * (element.textCase === "upper" ? 1.15 : 1) + element.letterSpacing * element.fontSize;
  const longest = Math.max(...lines.map((value) => value.length)) * average;
  const width = Math.min(element.width, longest);
  const wrapped = lines.reduce((sum, value) => sum + Math.max(1, Math.ceil((value.length * average) / Math.max(1, element.width))), 0);
  const height = Math.min(element.height, (wrapped - 1) * element.fontSize * element.lineHeight + element.fontSize);
  const x = element.align === "center" ? element.x + (element.width - width) / 2 : element.align === "right" ? element.x + element.width - width : element.x;
  const y = element.verticalAlign === "middle" ? element.y + (element.height - height) / 2 : element.verticalAlign === "bottom" ? element.y + element.height - height : element.y;
  return { x, y, width, height };
}

function decorative(element: StudioTextElement): boolean {
  return !/[\p{L}\p{N}]/u.test(textOf(element)) || element.opacity < 1;
}

function overlapIssues(page: StudioPage, pageIndex: number): QualityIssue[] {
  const texts = page.elements.filter((element): element is StudioTextElement => element.kind === "text" && !element.hidden && Boolean(textOf(element).trim()) && !decorative(element));
  const boxes = texts.map(inkBox);
  const issues: QualityIssue[] = [];
  texts.forEach((first, index) => {
    texts.slice(index + 1).forEach((second, offset) => {
      const a = boxes[index];
      const b = boxes[index + 1 + offset];
      const across = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (across > 2 && down > 2) issues.push({ page: pageIndex, kind: "overlap", detail: `"${textOf(first).slice(0, 20)}" × "${textOf(second).slice(0, 20)}"` });
    });
  });
  return issues;
}

function fitIssues(page: StudioPage, pageIndex: number): QualityIssue[] {
  return page.elements.flatMap((element) => {
    if (element.kind !== "text" || element.hidden || !textOf(element).trim()) return [];
    const needed = textOf(element).split("\n").length * element.fontSize * element.lineHeight;
    return element.height + 2 < needed ? [{ page: pageIndex, kind: "fit" as const, detail: `"${textOf(element).slice(0, 30)}" needs ${Math.ceil(needed)} > box ${Math.round(element.height)}` }] : [];
  });
}

export function fontFamilies(design: StudioDesign): string[] {
  const families = new Set<string>();
  for (const element of design.pages.flatMap((page) => page.elements)) {
    if (element.kind !== "text") continue;
    if (element.fontId) families.add(element.fontId);
    for (const run of element.runs) if (run.fontId && run.text.trim()) families.add(run.fontId);
  }
  return [...families];
}

export function qualityIssues(design: StudioDesign): QualityIssue[] {
  const issues = design.pages.flatMap((page, index) => [...contrastIssues(page, index), ...overlapIssues(page, index), ...fitIssues(page, index)]);
  const families = fontFamilies(design);
  if (families.length > MAX_FONT_FAMILIES) issues.push({ page: 0, kind: "fonts", detail: families.join(", ") });
  return issues;
}

import type {
  StudioDesign,
  StudioElement,
  StudioImageElement,
  StudioPage,
  StudioRenderBox,
  StudioRenderItem,
  StudioRenderPage,
  StudioRenderSegment,
  StudioTextElement,
} from "@/types/studio";
import { hasPlaceholders, textOf } from "./design";
import { ellipse, renderFill, renderStroke, roundedRect, shapePaths } from "./shapes";

export type MeasuredText = ReadonlyMap<string, StudioRenderSegment[]>;

export type RenderOptions = { keepWhite?: boolean };

function box(element: StudioElement): StudioRenderBox {
  return { x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, opacity: element.opacity };
}

function textItem(element: StudioTextElement, measured: MeasuredText): StudioRenderItem {
  const segments = measured.get(element.id);
  return {
    ...box(element),
    kind: "text",
    runs: element.runs.map((run) => ({
      text: run.text,
      bold: run.bold ?? element.bold,
      italic: run.italic ?? element.italic,
      underline: run.underline ?? element.underline,
      color: run.color ?? element.color,
    })),
    fontId: element.fontId,
    fontSize: element.fontSize,
    align: element.align,
    verticalAlign: element.verticalAlign,
    lineHeight: element.lineHeight,
    letterSpacing: element.letterSpacing * element.fontSize,
    uppercase: element.uppercase,
    shrinkToFit: element.shrinkToFit,
    ...(segments && !hasPlaceholders(textOf(element.runs)) ? { segments } : {}),
  };
}

function imageItems(element: StudioImageElement): StudioRenderItem[] {
  const crop = element.crop;
  const whole = crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
  const items: StudioRenderItem[] = element.src
    ? [{ ...box(element), kind: "image", path: element.src, fit: element.fit, crop: whole ? null : crop, mask: element.mask, radius: element.cornerRadius }]
    : [];
  const stroke = renderStroke(element.stroke);
  if (stroke) {
    const d =
      element.mask === "circle"
        ? ellipse(element.width / 2, element.height / 2, element.width / 2, element.height / 2)
        : roundedRect(0, 0, element.width, element.height, element.mask === "rounded" ? element.cornerRadius : 0);
    items.push({ ...box(element), kind: "vector", paths: [{ d, fill: null, stroke, evenOdd: false, opacity: 1 }] });
  }
  return items;
}

export function elementItems(element: StudioElement, measured: MeasuredText = new Map()): StudioRenderItem[] {
  if (element.hidden || element.opacity <= 0) return [];
  switch (element.kind) {
    case "text":
      return textOf(element.runs).trim() ? [textItem(element, measured)] : [];
    case "shape": {
      const paths = shapePaths(element);
      return paths.length ? [{ ...box(element), kind: "vector", paths }] : [];
    }
    case "image":
      return imageItems(element);
    case "qr":
      return element.value.trim() ? [{ ...box(element), kind: "qr", value: element.value, color: element.color, background: element.background, errorLevel: element.errorLevel }] : [];
    case "vector": {
      const paths = element.paths
        .map((path) => ({
          d: path.d,
          fill: renderFill(path.fill, element.viewWidth, element.viewHeight),
          stroke: renderStroke(path.stroke),
          evenOdd: path.evenOdd,
          opacity: path.opacity,
        }))
        .filter((path) => path.fill || path.stroke);
      return paths.length ? [{ ...box(element), kind: "vector", viewWidth: element.viewWidth, viewHeight: element.viewHeight, paths }] : [];
    }
    case "svg":
      return [{ ...box(element), kind: "svg", svg: element.svg }];
  }
}

function backgroundItems(page: StudioPage, keepWhite: boolean): StudioRenderItem[] {
  const frame: StudioRenderBox = { x: 0, y: 0, width: page.width, height: page.height, rotation: 0, opacity: 1 };
  const items: StudioRenderItem[] = [];
  const fill = renderFill(page.background.fill, page.width, page.height);
  const plainWhite = fill?.type === "solid" && fill.color.toLowerCase() === "#ffffff";
  if (fill && (keepWhite || !plainWhite)) items.push({ ...frame, kind: "vector", paths: [{ d: roundedRect(0, 0, page.width, page.height, 0), fill, stroke: null, evenOdd: false, opacity: 1 }] });
  const image = page.background.image;
  if (image && image.opacity > 0) items.push({ ...frame, opacity: image.opacity, kind: "image", path: image.src, fit: image.fit, crop: null, mask: "none", radius: 0 });
  return items;
}

export function pageToRender(page: StudioPage, measured: MeasuredText = new Map(), options: RenderOptions = {}): StudioRenderPage {
  return { width: page.width, height: page.height, items: [...backgroundItems(page, Boolean(options.keepWhite)), ...page.elements.flatMap((element) => elementItems(element, measured))] };
}

export function designToRender(design: StudioDesign, measured: MeasuredText = new Map(), options: RenderOptions = {}): StudioRenderPage[] {
  return design.pages.map((page) => pageToRender(page, measured, options));
}

export function hasSeeThroughBackground(page: StudioPage): boolean {
  return page.background.fill.type === "none" && !page.background.image;
}

export function imagePaths(design: StudioDesign): string[] {
  const paths = new Set<string>();
  for (const page of design.pages) {
    if (page.background.image) paths.add(page.background.image.src);
    for (const element of page.elements) if (element.kind === "image") paths.add(element.src);
  }
  return [...paths];
}

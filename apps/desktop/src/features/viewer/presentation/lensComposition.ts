export type ClientRect = { left: number; top: number; width: number; height: number };
export type LensRegion = { left: number; top: number; zoom: number };

export function lensRegion(x: number, y: number, size: number, zoom: number): LensRegion {
  const half = size / (2 * zoom);
  return { left: x - half, top: y - half, zoom };
}

export function placeInLens(rect: ClientRect, region: LensRegion): [number, number, number, number] {
  return [(rect.left - region.left) * region.zoom, (rect.top - region.top) * region.zoom, rect.width * region.zoom, rect.height * region.zoom];
}

export function intersectsLens(rect: ClientRect, region: LensRegion, size: number): boolean {
  const [left, top, width, height] = placeInLens(rect, region);
  return width > 0 && height > 0 && left < size && top < size && left + width > 0 && top + height > 0;
}

function styleElement(css: string): string {
  return css ? `<style>${css}</style>` : "";
}

export function svgSnapshotMarkup(markup: string, width: number, height: number, css = ""): string {
  const sized = markup.replace(/^<svg\b([^>]*)>/, (_whole, attributes: string) => {
    const cleaned = attributes.replace(/\s(width|height)="[^"]*"/g, "");
    const namespaced = /\sxmlns=/.test(cleaned) ? cleaned : `${cleaned} xmlns="http://www.w3.org/2000/svg"`;
    return `<svg${namespaced} width="${width}" height="${height}">${styleElement(css)}`;
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
}

export type StyleReader = (element: Element) => { getPropertyValue(property: string): string };

export const SVG_STYLE_PROPERTIES = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "opacity",
  "mix-blend-mode",
  "visibility",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
] as const;

export const HTML_STYLE_PROPERTIES = [
  "display",
  "box-sizing",
  "width",
  "height",
  "padding",
  "border",
  "border-radius",
  "background-color",
  "color",
  "opacity",
  "mix-blend-mode",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "white-space",
  "word-break",
  "overflow-wrap",
  "direction",
  "vertical-align",
  "writing-mode",
  "overflow",
] as const;

const DETACHED_ROOT_STYLE = "position:static;left:auto;top:auto;margin:0;transform:none";

export function inlineComputedStyles(source: Element, clone: Element, properties: readonly string[], read: StyleReader): void {
  const sources = [source, ...Array.from(source.querySelectorAll("*"))];
  const clones = [clone, ...Array.from(clone.querySelectorAll("*"))];
  sources.forEach((element, index) => {
    const target = clones[index];
    if (!target) return;
    const style = read(element);
    const declarations = properties.flatMap((property) => {
      const value = style.getPropertyValue(property);
      return value ? [`${property}:${value}`] : [];
    });
    if (declarations.length === 0) return;
    const existing = target.getAttribute("style");
    target.setAttribute("style", existing ? `${existing};${declarations.join(";")}` : declarations.join(";"));
  });
}

export function styledSnapshotClone<T extends Element>(source: T, properties: readonly string[], read: StyleReader): T {
  const clone = source.cloneNode(true) as T;
  inlineComputedStyles(source, clone, properties, read);
  return clone;
}

export function detachedRootStyle(style: string | null): string {
  return style ? `${style};${DETACHED_ROOT_STYLE}` : DETACHED_ROOT_STYLE;
}

export function usedFontFamilies(root: Element): string[] {
  const families: string[] = [];
  [root, ...Array.from(root.querySelectorAll("*"))].forEach((element) => {
    const value = (element as HTMLElement).style?.getPropertyValue("font-family");
    if (!value) return;
    value.split(",").forEach((name) => {
      const family = name.trim().replace(/^["']|["']$/g, "");
      if (family) families.push(family);
    });
  });
  return families;
}

export function inlineImageSources(source: Element, clone: Element, toDataUrl: (image: HTMLImageElement) => string | null): void {
  const clones = Array.from(clone.querySelectorAll("img"));
  Array.from(source.querySelectorAll("img")).forEach((image, index) => {
    const target = clones[index];
    const url = target ? toDataUrl(image) : null;
    if (target && url) target.setAttribute("src", url);
  });
}

export function loadingImages(element: Element): HTMLImageElement[] {
  return Array.from(element.querySelectorAll("img")).filter((image) => !image.complete && !image.src.startsWith("data:"));
}

export function htmlSnapshotMarkup(markup: string, width: number, height: number, scale: number, css = ""): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * scale}" height="${height * scale}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden">${styleElement(css)}${markup}</div>` +
    `</foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function htmlAnnotationRoots(layer: Element): Element[] {
  const roots = new Set<Element>();
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const holder = node.parentElement;
    if (!holder || holder.closest("svg, button, style, script, [data-epdf-rotation-handle]")) continue;
    let root: Element = holder;
    while (root.parentElement && root.parentElement !== layer && layer.contains(root.parentElement) && !root.parentElement.querySelector("svg, canvas, img, button")) {
      root = root.parentElement;
    }
    roots.add(root);
  }
  return Array.from(roots).filter((root) => !Array.from(roots).some((other) => other !== root && other.contains(root)));
}

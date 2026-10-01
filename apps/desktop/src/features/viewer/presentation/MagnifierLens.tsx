import { useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import {
  HTML_STYLE_PROPERTIES,
  SVG_STYLE_PROPERTIES,
  detachedRootStyle,
  htmlAnnotationRoots,
  htmlSnapshotMarkup,
  inlineImageSources,
  intersectsLens,
  lensRegion,
  loadingImages,
  placeInLens,
  styledSnapshotClone,
  svgSnapshotMarkup,
  usedFontFamilies,
  type LensRegion,
} from "./lensComposition";
import { bundledFontFamily, fontFaceRules, fontSourceVersion, loadBundledFontSources } from "../overlay/embeddedFonts";
import { drawStroke } from "./strokes";
import type { PageRect } from "./usePageRects";

type Source = HTMLImageElement | HTMLCanvasElement;

const NO_STROKES: Stroke[] = [];
const SVG_CACHE_LIMIT = 64;
const svgSnapshots = new Map<string, HTMLImageElement>();

function isReady(element: Source): boolean {
  if (element instanceof HTMLCanvasElement) return element.width > 0 && element.height > 0;
  return element.complete && element.naturalWidth > 0;
}

const readComputedStyle = (element: Element) => getComputedStyle(element);

function imageDataUrl(image: HTMLImageElement): string | null {
  if (image.src.startsWith("data:")) return image.src;
  if (!image.complete || image.naturalWidth === 0) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function snapshotFontRules(clone: Element, onLoad: () => void): string {
  const families = usedFontFamilies(clone);
  const bundled = families.filter(bundledFontFamily);
  if (bundled.length > 0 && !fontFaceRules(bundled)) {
    void loadBundledFontSources().then((loaded) => {
      if (loaded) onLoad();
    });
  }
  return fontFaceRules(families);
}

function cachedSnapshot(key: string, buildUrl: () => string, onLoad: () => void): HTMLImageElement | null {
  const known = svgSnapshots.get(key);
  if (known) return known.complete && known.naturalWidth > 0 ? known : null;
  if (svgSnapshots.size >= SVG_CACHE_LIMIT) {
    const oldest = svgSnapshots.keys().next().value;
    if (oldest !== undefined) svgSnapshots.delete(oldest);
  }
  const image = new Image();
  image.onload = onLoad;
  image.src = buildUrl();
  svgSnapshots.set(key, image);
  return null;
}

function svgSnapshot(svg: SVGSVGElement, width: number, height: number, onLoad: () => void): HTMLImageElement | null {
  const serializer = new XMLSerializer();
  const key = `svg:${width}x${height}#${fontSourceVersion()}:${serializer.serializeToString(svg)}`;
  return cachedSnapshot(
    key,
    () => {
      const clone = styledSnapshotClone(svg, SVG_STYLE_PROPERTIES, readComputedStyle);
      return svgSnapshotMarkup(serializer.serializeToString(clone), width, height, snapshotFontRules(clone, onLoad));
    },
    onLoad,
  );
}

function htmlSnapshot(element: Element, width: number, height: number, scale: number, onLoad: () => void): HTMLImageElement | null {
  const loading = loadingImages(element);
  if (loading.length > 0) {
    loading.forEach((image) => {
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onLoad, { once: true });
    });
    return null;
  }
  const key = `html:${width}x${height}@${scale}#${fontSourceVersion()}:${element.outerHTML}`;
  return cachedSnapshot(
    key,
    () => {
      const clone = styledSnapshotClone(element, HTML_STYLE_PROPERTIES, readComputedStyle);
      clone.setAttribute("style", detachedRootStyle(clone.getAttribute("style")));
      inlineImageSources(element, clone, imageDataUrl);
      return htmlSnapshotMarkup(new XMLSerializer().serializeToString(clone), width, height, scale, snapshotFontRules(clone, onLoad));
    },
    onLoad,
  );
}

function drawHtmlAnnotations(ctx: CanvasRenderingContext2D, pageEl: HTMLElement, region: LensRegion, size: number, onLoad: () => void) {
  const scale = region.zoom * (window.devicePixelRatio || 1);
  pageEl.querySelectorAll("[data-annotation-layer]").forEach((layer) => {
    htmlAnnotationRoots(layer).forEach((root) => {
      const rect = root.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || !intersectsLens(rect, region, size)) return;
      const [left, top, width, height] = placeInLens(rect, region);
      const snapshot = htmlSnapshot(root, rect.width, rect.height, scale, onLoad);
      if (snapshot) ctx.drawImage(snapshot, left, top, width, height);
    });
  });
}

function drawPageLayers(ctx: CanvasRenderingContext2D, pageEl: HTMLElement, region: LensRegion, size: number, onLoad: () => void) {
  const layers = pageEl.querySelectorAll<Source | SVGSVGElement>("img, canvas, svg");
  layers.forEach((layer) => {
    if (layer.closest("button, [data-epdf-rotation-handle]")) return;
    if (layer instanceof SVGSVGElement && layer.parentElement?.closest("svg")) return;
    const rect = layer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || !intersectsLens(rect, region, size)) return;
    const [left, top, width, height] = placeInLens(rect, region);
    if (layer instanceof SVGSVGElement) {
      const snapshot = svgSnapshot(layer, rect.width, rect.height, onLoad);
      if (snapshot) ctx.drawImage(snapshot, left, top, width, height);
      return;
    }
    if (isReady(layer)) ctx.drawImage(layer, left, top, width, height);
  });
  drawHtmlAnnotations(ctx, pageEl, region, size, onLoad);
}

function drawInk(ctx: CanvasRenderingContext2D, strokes: Stroke[], pageClientRect: DOMRect, region: LensRegion) {
  if (strokes.length === 0) return;
  const [left, top, width, height] = placeInLens(pageClientRect, region);
  ctx.save();
  ctx.translate(left, top);
  strokes.forEach((stroke) => drawStroke(ctx, stroke, width, height));
  ctx.restore();
}

export function MagnifierLens({ x, y, pageRect }: { x: number; y: number; pageRect: PageRect | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, setLoadedSnapshots] = useState(0);
  const size = usePresentationStore((state) => state.magnifierSize);
  const zoom = usePresentationStore((state) => state.magnifierZoom);
  const shape = usePresentationStore((state) => state.magnifierShape);
  const strokes = usePresentationStore((state) => (pageRect ? (state.strokesByPage[pageRect.pageIndex] ?? NO_STROKES) : NO_STROKES));

  const setCanvasRef = (node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (!node || !pageRect) return;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    node.width = Math.round(size * dpr);
    node.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const pageEl = document.querySelector<HTMLElement>(`[data-page-index="${pageRect.pageIndex}"]`);
    if (!pageEl) return;
    const region = lensRegion(x, y, size, zoom);
    ctx.save();
    ctx.beginPath();
    if (shape === "circle") ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    else ctx.rect(0, 0, size, size);
    ctx.clip();
    ctx.imageSmoothingQuality = "high";
    drawPageLayers(ctx, pageEl, region, size, () => setLoadedSnapshots((count) => count + 1));
    drawInk(ctx, strokes, pageEl.getBoundingClientRect(), region);
    ctx.restore();
  };

  return (
    <canvas
      ref={setCanvasRef}
      aria-hidden
      data-magnifier-lens=""
      className={cn("pointer-events-none fixed z-40 bg-white ring-2 ring-white/70 shadow-(--shadow-float)", shape === "circle" ? "rounded-full" : "rounded-lg")}
      style={{ left: x - size / 2, top: y - size / 2, width: size, height: size }}
    />
  );
}

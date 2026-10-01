import { frameToLocal, type QuarterTurns } from "./pageFrame";

type Box = { left: number; top: number; width: number; height: number };

const INSET = 3;
const ALPHA = 1;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 255;
}

function layoutOrigin(node: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  for (let current: HTMLElement | null = node; current; current = current.offsetParent as HTMLElement | null) {
    left += current.offsetLeft;
    top += current.offsetTop;
  }
  return { left, top };
}

function samplePoint(sources: Array<HTMLImageElement | HTMLCanvasElement>, pageOrigin: { left: number; top: number }, x: number, y: number, context: CanvasRenderingContext2D): [number, number, number] | null {
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    const sourceWidth = source.offsetWidth;
    const sourceHeight = source.offsetHeight;
    const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!naturalWidth || !naturalHeight || sourceWidth === 0 || sourceHeight === 0 || (source instanceof HTMLImageElement && !source.complete)) continue;
    const origin = layoutOrigin(source);
    const offsetX = origin.left - pageOrigin.left;
    const offsetY = origin.top - pageOrigin.top;
    if (x < offsetX || y < offsetY || x > offsetX + sourceWidth || y > offsetY + sourceHeight) continue;
    const sx = Math.min(naturalWidth - 1, Math.max(0, Math.round((x - offsetX) * (naturalWidth / sourceWidth))));
    const sy = Math.min(naturalHeight - 1, Math.max(0, Math.round((y - offsetY) * (naturalHeight / sourceHeight))));
    try {
      context.clearRect(0, 0, 1, 1);
      context.drawImage(source, sx, sy, 1, 1, 0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      if (a < 200) continue;
      return [r, g, b];
    } catch {
      continue;
    }
  }
  return null;
}

export function sampleBackground(pageElement: HTMLElement | null, box: Box, turns: QuarterTurns = 0): string | null {
  if (!pageElement) return null;
  const sources = Array.from(pageElement.querySelectorAll<HTMLImageElement | HTMLCanvasElement>("img, canvas")).filter((node) => !node.closest("[data-overlay-layer]"));
  if (sources.length === 0) return null;
  const pageOrigin = layoutOrigin(pageElement);
  const framePoints = [
    [box.left - INSET, box.top - INSET],
    [box.left + box.width + INSET, box.top - INSET],
    [box.left - INSET, box.top + box.height + INSET],
    [box.left + box.width + INSET, box.top + box.height + INSET],
    [box.left + box.width / 2, box.top - INSET],
    [box.left + box.width / 2, box.top + box.height + INSET],
  ];
  const points = framePoints.map(([x, y]) => frameToLocal(turns, pageElement.offsetWidth, pageElement.offsetHeight, x, y));
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (const { x, y } of points) {
    const pixel = samplePoint(sources, pageOrigin, x, y, context);
    if (!pixel) continue;
    reds.push(pixel[0]);
    greens.push(pixel[1]);
    blues.push(pixel[2]);
  }
  if (reds.length === 0) return null;
  return `rgba(${median(reds)}, ${median(greens)}, ${median(blues)}, ${ALPHA})`;
}

export function contrastingBackground(textColor: string | undefined): string {
  const hex = (textColor ?? "").replace("#", "");
  if (hex.length !== 6) return "rgba(255,255,255,1)";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "rgba(40,40,44,1)" : "rgba(255,255,255,1)";
}

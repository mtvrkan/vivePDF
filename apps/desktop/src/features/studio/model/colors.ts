import type { StudioDesign, StudioElement, StudioFill, StudioPage, StudioStroke } from "@/types/studio";
import { effectiveSvgColors, swapSvgColors } from "./svgColors";
import { graphicColors, swapGraphicColors } from "../graphics/graphicColors";
import { graphicOf } from "../graphics/graphicData";

type Swap = (color: string) => string;

const key = (color: string) => color.toLowerCase();

function fillColors(fill: StudioFill): string[] {
  if (fill.type === "solid") return [fill.color];
  if (fill.type === "linear" || fill.type === "radial") return fill.stops.map((stop) => stop.color);
  return [];
}

function swapFill(fill: StudioFill, swap: Swap): StudioFill {
  if (fill.type === "solid") return { ...fill, color: swap(fill.color) };
  if (fill.type === "linear" || fill.type === "radial") return { ...fill, stops: fill.stops.map((stop) => ({ ...stop, color: swap(stop.color) })) };
  return fill;
}

function swapStroke(stroke: StudioStroke | null, swap: Swap): StudioStroke | null {
  return stroke ? { ...stroke, color: swap(stroke.color) } : null;
}

export function elementColors(element: StudioElement): string[] {
  switch (element.kind) {
    case "text":
      return [element.color, ...element.runs.flatMap((run) => (run.color ? [run.color] : []))];
    case "shape":
      return [...fillColors(element.fill), ...(element.stroke ? [element.stroke.color] : [])];
    case "image":
      return element.stroke ? [element.stroke.color] : [];
    case "qr":
      return [element.color, ...(element.background ? [element.background] : [])];
    case "vector":
      return element.paths.flatMap((path) => [...fillColors(path.fill), ...(path.stroke ? [path.stroke.color] : [])]);
    case "svg": {
      const graphic = graphicOf(element);
      return graphic ? graphicColors(graphic) : effectiveSvgColors(element.svg, element.colorMap);
    }
  }
}

function swapElement(element: StudioElement, swap: Swap): StudioElement {
  switch (element.kind) {
    case "text":
      return { ...element, color: swap(element.color), runs: element.runs.map((run) => (run.color ? { ...run, color: swap(run.color) } : run)) };
    case "shape":
      return { ...element, fill: swapFill(element.fill, swap), stroke: swapStroke(element.stroke, swap) };
    case "image":
      return { ...element, stroke: swapStroke(element.stroke, swap) };
    case "qr":
      return { ...element, color: swap(element.color), background: element.background ? swap(element.background) : null };
    case "vector":
      return { ...element, paths: element.paths.map((path) => ({ ...path, fill: swapFill(path.fill, swap), stroke: swapStroke(path.stroke, swap) })) };
    case "svg": {
      const graphic = graphicOf(element);
      if (graphic) return swapGraphicColors(element, graphic, swap);
      const colorMap = swapSvgColors(element.svg, element.colorMap, swap);
      if (colorMap === element.colorMap) return element;
      const next = { ...element, colorMap };
      if (!colorMap) delete next.colorMap;
      return next;
    }
  }
}

function replacer(from: string, to: string): Swap {
  const wanted = key(from);
  return (color) => (key(color) === wanted ? to : color);
}

function unique(colors: string[]): string[] {
  const seen = new Map<string, string>();
  for (const color of colors) if (!seen.has(key(color))) seen.set(key(color), key(color));
  return [...seen.values()];
}

export function uniqueElementColors(element: StudioElement): string[] {
  return unique(elementColors(element));
}

export function recolorElement(element: StudioElement, from: string, to: string): StudioElement {
  return swapElement(element, replacer(from, to));
}

function pageColors(page: StudioPage): string[] {
  return [...fillColors(page.background.fill), ...page.elements.flatMap(elementColors)];
}

export function designColors(design: StudioDesign): string[] {
  const counts = new Map<string, number>();
  for (const color of design.pages.flatMap(pageColors)) counts.set(key(color), (counts.get(key(color)) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([color]) => color);
}

export function recolorDesign(design: StudioDesign, from: string, to: string): StudioDesign {
  const swap = replacer(from, to);
  return {
    ...design,
    pages: design.pages.map((page) => ({
      ...page,
      background: { ...page.background, fill: swapFill(page.background.fill, swap) },
      elements: page.elements.map((element) => swapElement(element, swap)),
    })),
  };
}

import type { StudioDesign, StudioElement, StudioFill, StudioPage, StudioShapeKind, StudioStroke, StudioTextAlign, StudioTextElement, StudioTextRun, StudioVerticalAlign } from "@/types/studio";
import { STUDIO_DESIGN_VERSION } from "@/types/studio";
import { createImage, createPage, createQr, createShape, createText, createVector, newId, STUDIO_PAGE_SIZES, type StudioPageSize } from "../model/design";
import { ornament, type OrnamentColors } from "../ornaments/ornaments";

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type TemplateCategory = "certificates" | "invitations" | "cards" | "posters" | "menus" | "business" | "education" | "personal" | "labels";

export type TemplateContext = { t: Translate; language: string };

export type TemplateSize = StudioPageSize | { width: number; height: number };

export type StudioTemplate = {
  id: string;
  category: TemplateCategory;
  size: TemplateSize;
  build: (context: TemplateContext) => StudioDesign;
};

export const FONTS = {
  inter: "library:inter",
  montserrat: "library:montserrat",
  poppins: "library:poppins",
  raleway: "library:raleway",
  nunito: "library:nunito",
  josefin: "library:josefin-sans",
  oswald: "library:oswald",
  bebas: "library:bebas-neue",
  abril: "library:abril-fatface",
  cinzel: "library:cinzel",
  playfair: "library:playfair-display",
  lora: "library:lora",
  merriweather: "library:merriweather",
  baskerville: "library:libre-baskerville",
  cormorant: "library:cormorant-garamond",
  garamond: "library:eb-garamond",
  sourceSerif: "library:source-serif-4",
  greatVibes: "library:great-vibes",
  dancing: "library:dancing-script",
  parisienne: "library:parisienne",
  allura: "library:allura",
  alexBrush: "library:alex-brush",
  caveat: "library:caveat",
  pacifico: "library:pacifico",
} as const;

export type TextOptions = {
  font?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: StudioTextAlign;
  valign?: StudioVerticalAlign;
  spacing?: number;
  upper?: boolean;
  lineHeight?: number;
  shrink?: boolean;
  runs?: StudioTextRun[];
  name?: string;
  rotation?: number;
};

export function text(x: number, y: number, width: number, height: number, value: string, options: TextOptions = {}): StudioTextElement {
  const fontSize = options.size ?? 14;
  return createText(x, y, width, height, value, {
    name: options.name ?? "",
    runs: options.runs ?? [{ text: value }],
    fontId: options.font ?? FONTS.inter,
    fontSize,
    color: options.color ?? "#1f2937",
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    align: options.align ?? "left",
    verticalAlign: options.valign ?? "top",
    letterSpacing: Math.round(((options.spacing ?? 0) / fontSize) * 1000) / 1000,
    uppercase: options.upper ?? false,
    lineHeight: options.lineHeight ?? 1.3,
    shrinkToFit: options.shrink ?? false,
    rotation: options.rotation ?? 0,
  });
}

export function centredText(page: { width: number }, y: number, height: number, value: string, options: TextOptions & { inset?: number } = {}): StudioTextElement {
  const inset = options.inset ?? page.width * 0.12;
  return text(inset, y, page.width - inset * 2, height, value, { align: "center", ...options });
}

export function solid(color: string): StudioFill {
  return { type: "solid", color };
}

export function linear(angle: number, from: string, to: string): StudioFill {
  return { type: "linear", angle, stops: [{ offset: 0, color: from }, { offset: 1, color: to }] };
}

export function stroke(color: string, width = 1, dash: StudioStroke["dash"] = "solid"): StudioStroke {
  return { color, width, dash };
}

export function box(kind: StudioShapeKind, x: number, y: number, width: number, height: number, fill: StudioFill, options: { stroke?: StudioStroke | null; radius?: number; opacity?: number; rotation?: number; points?: number; inner?: number } = {}) {
  return {
    ...createShape(kind, x, y, width, height, { fill, stroke: options.stroke ?? null, cornerRadius: options.radius ?? 0, ...(options.points ? { points: options.points } : {}), ...(options.inner ? { innerRatio: options.inner } : {}) }),
    opacity: options.opacity ?? 1,
    rotation: options.rotation ?? 0,
  };
}

export function rule(x: number, y: number, width: number, color: string, weight = 1, dash: StudioStroke["dash"] = "solid") {
  return createShape("line", x, y - 4, width, 8, { fill: { type: "none" }, stroke: stroke(color, weight, dash) });
}

export function art(id: string, colours: OrnamentColors, x: number, y: number, width: number, height: number, options: { rotation?: number; opacity?: number } = {}): StudioElement {
  const item = ornament(id);
  if (!item) throw new Error(`unknown ornament ${id}`);
  const built = item.build(colours, item.fitsPage ? { width, height } : item.size);
  return { ...createVector(built, x, y, width, height, id), rotation: options.rotation ?? 0, opacity: options.opacity ?? 1 };
}

export function frame(id: string, colours: OrnamentColors, page: { width: number; height: number }): StudioElement {
  return art(id, colours, 0, 0, page.width, page.height);
}

export function qr(value: string, x: number, y: number, side: number, color = "#111827"): StudioElement {
  return { ...createQr(value, x, y, side), color, background: null };
}

export function photo(x: number, y: number, width: number, height: number, mask: "none" | "rounded" | "circle" = "none") {
  return { ...createImage("", x, y, width, height), mask, cornerRadius: mask === "rounded" ? 12 : 0 };
}

export function photoSlot(x: number, y: number, width: number, height: number, backing: string, mask: "none" | "rounded" | "circle" = "none"): StudioElement[] {
  const shape = mask === "circle" ? box("ellipse", x, y, width, height, solid(backing)) : box("rect", x, y, width, height, solid(backing), { radius: mask === "rounded" ? 12 : 0 });
  return [shape, photo(x, y, width, height, mask)];
}

export function vrule(x: number, y: number, length: number, color: string, weight = 1, dash: StudioStroke["dash"] = "solid") {
  return { ...rule(x - length / 2, y + length / 2, length, color, weight, dash), rotation: 90 };
}

export function pageOf(size: TemplateSize, background: StudioFill, elements: StudioElement[]): StudioPage {
  const { width, height } = sizeOf(size);
  return { ...createPage(width, height), background: { fill: background, image: null }, elements };
}

export function design(name: string, palette: string[], pages: StudioPage[]): StudioDesign {
  return { version: STUDIO_DESIGN_VERSION, kind: "design", name, palette, pages: pages.map((page) => ({ ...page, id: page.id || newId() })) };
}

export function sizeOf(size: TemplateSize): { width: number; height: number } {
  return typeof size === "string" ? STUDIO_PAGE_SIZES[size] : size;
}

export type GridOptions = {
  font?: string;
  size?: number;
  color?: string;
  headerFill?: string;
  headerColor?: string;
  lineColor?: string;
  zebra?: string;
  aligns?: StudioTextAlign[];
};

export function grid(x: number, y: number, columns: number[], rowHeight: number, rows: string[][], options: GridOptions = {}): StudioElement[] {
  const width = columns.reduce((sum, column) => sum + column, 0);
  const lineColor = options.lineColor ?? "#d1d5db";
  const elements: StudioElement[] = [];
  rows.forEach((row, rowIndex) => {
    const top = y + rowIndex * rowHeight;
    const header = rowIndex === 0 ? options.headerFill : undefined;
    if (header) elements.push(box("rect", x, top, width, rowHeight, solid(header)));
    else if (options.zebra && rowIndex % 2 === 0) elements.push(box("rect", x, top, width, rowHeight, solid(options.zebra)));
    let left = x;
    row.forEach((cell, columnIndex) => {
      const columnWidth = columns[columnIndex] ?? 0;
      if (cell) {
        elements.push(
          text(left + 6, top, columnWidth - 12, rowHeight, cell, {
            font: options.font,
            size: options.size ?? 10,
            color: header ? (options.headerColor ?? "#ffffff") : (options.color ?? "#1f2937"),
            bold: Boolean(header),
            align: options.aligns?.[columnIndex] ?? "left",
            valign: "middle",
            shrink: true,
          }),
        );
      }
      left += columnWidth;
    });
    elements.push(rule(x, top + rowHeight, width, lineColor, 0.6));
  });
  return elements;
}

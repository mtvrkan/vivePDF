import {
  STUDIO_DESIGN_VERSION,
  STUDIO_SHAPES,
  type StudioBackground,
  type StudioCrop,
  type StudioDesign,
  type StudioElement,
  type StudioElementBase,
  type StudioFill,
  type StudioImageElement,
  type StudioPage,
  type StudioQrElement,
  type StudioShapeElement,
  type StudioShapeKind,
  type StudioStroke,
  type StudioTextElement,
  type StudioTextRun,
  type StudioVectorPath,
} from "@/types/studio";

export const STUDIO_PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  a4Landscape: { width: 841.89, height: 595.28 },
  a5: { width: 419.53, height: 595.28 },
  letter: { width: 612, height: 792 },
  letterLandscape: { width: 792, height: 612 },
  businessCard: { width: 252, height: 144 },
  square: { width: 810, height: 810 },
  story: { width: 810, height: 1440 },
  presentation: { width: 960, height: 540 },
  poster: { width: 841.89, height: 1190.55 },
} as const;
export type StudioPageSize = keyof typeof STUDIO_PAGE_SIZES;

export const MIN_PAGE_SIDE = 18;
export const MAX_PAGE_SIDE = 14400;
export const MIN_ELEMENT_SIDE = 1;
export const MAX_ELEMENTS_PER_PAGE = 2000;
export const MAX_PAGES = 500;
export const BUILTIN_PLACEHOLDERS = ["n", "date"] as const;

const PLACEHOLDER = /(?<!\{)\{([^{}]+)\}/g;
const COLOUR = /^#[0-9a-f]{6}$/i;

export function newId(): string {
  return crypto.randomUUID();
}

export function blankBackground(): StudioBackground {
  return { fill: { type: "solid", color: "#ffffff" }, image: null };
}

export function createPage(width: number, height: number): StudioPage {
  return { id: newId(), width: clampSide(width), height: clampSide(height), background: blankBackground(), elements: [] };
}

export function createDesign(name: string, width: number, height: number): StudioDesign {
  return { version: STUDIO_DESIGN_VERSION, kind: "design", name, palette: [], pages: [createPage(width, height)] };
}

function base(x: number, y: number, width: number, height: number, name: string): StudioElementBase {
  return { id: newId(), name, x, y, width, height, rotation: 0, opacity: 1, locked: false, hidden: false, groupId: null };
}

export function createText(x: number, y: number, width: number, height: number, text: string, overrides: Partial<StudioTextElement> = {}): StudioTextElement {
  return {
    ...base(x, y, width, height, ""),
    kind: "text",
    runs: [{ text }],
    fontId: null,
    fontSize: 24,
    color: "#1f2937",
    bold: false,
    italic: false,
    underline: false,
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.25,
    letterSpacing: 0,
    uppercase: false,
    shrinkToFit: false,
    ...overrides,
  };
}

export function createShape(shape: StudioShapeKind, x: number, y: number, width: number, height: number, overrides: Partial<StudioShapeElement> = {}): StudioShapeElement {
  const lineLike = shape === "line" || shape === "arrowLine";
  return {
    ...base(x, y, width, height, ""),
    kind: "shape",
    shape,
    fill: lineLike ? { type: "none" } : { type: "solid", color: "#3b82f6" },
    stroke: lineLike ? { color: "#1f2937", width: 2, dash: "solid" } : null,
    cornerRadius: 0,
    points: shape === "star" ? 5 : shape === "burst" ? 16 : 6,
    innerRatio: shape === "burst" ? 0.8 : 0.45,
    ...overrides,
  };
}

export function createImage(src: string, x: number, y: number, width: number, height: number): StudioImageElement {
  return {
    ...base(x, y, width, height, ""),
    kind: "image",
    src,
    fit: "cover",
    crop: { x: 0, y: 0, width: 1, height: 1 },
    mask: "none",
    cornerRadius: 0,
    stroke: null,
  };
}

export function createQr(value: string, x: number, y: number, side: number): StudioQrElement {
  return { ...base(x, y, side, side, ""), kind: "qr", value, color: "#000000", background: "#ffffff", errorLevel: "M" };
}

export function textOf(runs: StudioTextRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function placeholdersIn(design: StudioDesign): string[] {
  const found = new Set<string>();
  const collect = (value: string) => {
    for (const match of value.matchAll(PLACEHOLDER)) {
      const name = match[1].trim();
      if (name && !BUILTIN_PLACEHOLDERS.includes(name as (typeof BUILTIN_PLACEHOLDERS)[number])) found.add(name);
    }
  };
  for (const page of design.pages) {
    for (const element of page.elements) {
      if (element.kind === "text") collect(textOf(element.runs));
      if (element.kind === "qr") collect(element.value);
    }
  }
  return [...found];
}

export function hasPlaceholders(value: string): boolean {
  return new RegExp(PLACEHOLDER.source).test(value);
}

function clampSide(value: number): number {
  return Math.min(MAX_PAGE_SIDE, Math.max(MIN_PAGE_SIDE, Number.isFinite(value) ? value : MIN_PAGE_SIDE));
}

function finite(value: unknown, fallback: number, min = -100000, max = 100000): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function text(value: unknown, fallback = "", limit = 20000): string {
  return typeof value === "string" ? value.slice(0, limit) : fallback;
}

function colour(value: unknown, fallback: string): string {
  return typeof value === "string" && COLOUR.test(value) ? value.toLowerCase() : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeStops(value: unknown): { offset: number; color: string }[] {
  const stops = (Array.isArray(value) ? value : [])
    .map(record)
    .filter((stop): stop is Record<string, unknown> => stop !== null)
    .slice(0, 32)
    .map((stop) => ({ offset: finite(stop.offset, 0, 0, 1), color: colour(stop.color, "#000000") }));
  return stops.length ? stops : [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }];
}

export function normalizeFill(value: unknown): StudioFill {
  const fill = record(value);
  if (fill?.type === "solid") return { type: "solid", color: colour(fill.color, "#000000") };
  if (fill?.type === "linear") return { type: "linear", angle: finite(fill.angle, 0, -3600, 3600), stops: normalizeStops(fill.stops) };
  if (fill?.type === "radial") return { type: "radial", stops: normalizeStops(fill.stops) };
  return { type: "none" };
}

export function normalizeStroke(value: unknown): StudioStroke | null {
  const stroke = record(value);
  if (!stroke) return null;
  return { color: colour(stroke.color, "#000000"), width: finite(stroke.width, 1, 0.1, 500), dash: oneOf(stroke.dash, ["solid", "dashed", "dotted"], "solid") };
}

function normalizeCrop(value: unknown): StudioCrop {
  const crop = record(value);
  const x = finite(crop?.x, 0, 0, 0.99);
  const y = finite(crop?.y, 0, 0, 0.99);
  return { x, y, width: finite(crop?.width, 1, 0.01, 1 - x), height: finite(crop?.height, 1, 0.01, 1 - y) };
}

function normalizeRuns(value: unknown): StudioTextRun[] {
  const runs = (Array.isArray(value) ? value : [])
    .map(record)
    .filter((run): run is Record<string, unknown> => run !== null)
    .slice(0, 2000)
    .map((run) => {
      const result: StudioTextRun = { text: text(run.text) };
      if (run.bold === true || run.bold === false) result.bold = run.bold;
      if (run.italic === true || run.italic === false) result.italic = run.italic;
      if (run.underline === true || run.underline === false) result.underline = run.underline;
      if (typeof run.color === "string" && COLOUR.test(run.color)) result.color = run.color.toLowerCase();
      return result;
    });
  return runs.length ? runs : [{ text: "" }];
}

function normalizePaths(value: unknown): StudioVectorPath[] {
  return (Array.isArray(value) ? value : [])
    .map(record)
    .filter((path): path is Record<string, unknown> => path !== null && typeof path.d === "string" && path.d.length > 0)
    .slice(0, 5000)
    .map((path) => ({
      d: text(path.d, "", 400000),
      fill: normalizeFill(path.fill),
      stroke: normalizeStroke(path.stroke),
      evenOdd: path.evenOdd === true,
      opacity: finite(path.opacity, 1, 0, 1),
    }));
}

export function normalizeElement(value: unknown): StudioElement | null {
  const raw = record(value);
  if (!raw) return null;
  const shared: StudioElementBase = {
    id: text(raw.id, "", 100) || newId(),
    name: text(raw.name, "", 200),
    x: finite(raw.x, 0),
    y: finite(raw.y, 0),
    width: finite(raw.width, 100, MIN_ELEMENT_SIDE, 20000),
    height: finite(raw.height, 100, MIN_ELEMENT_SIDE, 20000),
    rotation: finite(raw.rotation, 0, -3600, 3600),
    opacity: finite(raw.opacity, 1, 0, 1),
    locked: raw.locked === true,
    hidden: raw.hidden === true,
    groupId: typeof raw.groupId === "string" && raw.groupId ? raw.groupId.slice(0, 100) : null,
  };
  switch (raw.kind) {
    case "text":
      return {
        ...shared,
        kind: "text",
        runs: normalizeRuns(raw.runs),
        fontId: typeof raw.fontId === "string" && raw.fontId ? raw.fontId.slice(0, 1024) : null,
        fontSize: finite(raw.fontSize, 24, 1, 1000),
        color: colour(raw.color, "#000000"),
        bold: raw.bold === true,
        italic: raw.italic === true,
        underline: raw.underline === true,
        align: oneOf(raw.align, ["left", "center", "right", "justify"], "left"),
        verticalAlign: oneOf(raw.verticalAlign, ["top", "middle", "bottom"], "top"),
        lineHeight: finite(raw.lineHeight, 1.25, 0.5, 5),
        letterSpacing: finite(raw.letterSpacing, 0, -0.5, 2),
        uppercase: raw.uppercase === true,
        shrinkToFit: raw.shrinkToFit === true,
      };
    case "shape":
      return {
        ...shared,
        kind: "shape",
        shape: oneOf(raw.shape, STUDIO_SHAPES, "rect"),
        fill: normalizeFill(raw.fill),
        stroke: normalizeStroke(raw.stroke),
        cornerRadius: finite(raw.cornerRadius, 0, 0, 10000),
        points: Math.round(finite(raw.points, 5, 3, 64)),
        innerRatio: finite(raw.innerRatio, 0.45, 0.05, 0.95),
      };
    case "image":
      if (typeof raw.src !== "string" || !raw.src) return null;
      return {
        ...shared,
        kind: "image",
        src: raw.src.slice(0, 4096),
        fit: oneOf(raw.fit, ["cover", "contain", "stretch"], "cover"),
        crop: normalizeCrop(raw.crop),
        mask: oneOf(raw.mask, ["none", "rounded", "circle"], "none"),
        cornerRadius: finite(raw.cornerRadius, 0, 0, 10000),
        stroke: normalizeStroke(raw.stroke),
      };
    case "qr":
      return {
        ...shared,
        kind: "qr",
        value: text(raw.value, "", 2000) || "vivePDF",
        color: colour(raw.color, "#000000"),
        background: raw.background === null ? null : colour(raw.background, "#ffffff"),
        errorLevel: oneOf(raw.errorLevel, ["L", "M", "Q", "H"], "M"),
      };
    case "vector": {
      const paths = normalizePaths(raw.paths);
      if (!paths.length) return null;
      return { ...shared, kind: "vector", viewWidth: finite(raw.viewWidth, shared.width, 0.01, 100000), viewHeight: finite(raw.viewHeight, shared.height, 0.01, 100000), paths };
    }
    case "svg":
      if (typeof raw.svg !== "string" || !raw.svg) return null;
      return { ...shared, kind: "svg", svg: raw.svg.slice(0, 4000000), source: oneOf(raw.source, ["table", "chart", "formula", "flowchart", "import"], "import"), data: raw.data ?? null };
    default:
      return null;
  }
}

function normalizeBackground(value: unknown): StudioBackground {
  const background = record(value);
  if (!background) return blankBackground();
  const image = record(background.image);
  return {
    fill: normalizeFill(background.fill),
    image: image && typeof image.src === "string" && image.src
      ? { src: image.src.slice(0, 4096), fit: oneOf(image.fit, ["cover", "contain", "stretch"], "cover"), opacity: finite(image.opacity, 1, 0, 1) }
      : null,
  };
}

export function normalizePage(value: unknown): StudioPage | null {
  const raw = record(value);
  if (!raw) return null;
  const seen = new Set<string>();
  const elements: StudioElement[] = [];
  for (const item of Array.isArray(raw.elements) ? raw.elements.slice(0, MAX_ELEMENTS_PER_PAGE) : []) {
    const element = normalizeElement(item);
    if (!element) continue;
    if (seen.has(element.id)) element.id = newId();
    seen.add(element.id);
    elements.push(element);
  }
  return {
    id: text(raw.id, "", 100) || newId(),
    width: clampSide(finite(raw.width, STUDIO_PAGE_SIZES.a4.width)),
    height: clampSide(finite(raw.height, STUDIO_PAGE_SIZES.a4.height)),
    background: normalizeBackground(raw.background),
    elements,
  };
}

export function normalizeDesign(value: unknown): StudioDesign | null {
  const raw = record(value);
  if (!raw || raw.kind !== "design") return null;
  if (typeof raw.version !== "number" || raw.version > STUDIO_DESIGN_VERSION) return null;
  const pages = (Array.isArray(raw.pages) ? raw.pages.slice(0, MAX_PAGES) : []).map(normalizePage).filter((page): page is StudioPage => page !== null);
  if (!pages.length) return null;
  const palette = (Array.isArray(raw.palette) ? raw.palette : []).filter((item): item is string => typeof item === "string" && COLOUR.test(item)).slice(0, 24);
  return { version: STUDIO_DESIGN_VERSION, kind: "design", name: text(raw.name, "", 200), palette, pages };
}

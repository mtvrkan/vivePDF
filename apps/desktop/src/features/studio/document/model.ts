import { STUDIO_DOCUMENT_VERSION, type DocumentAlign, type DocumentColumns, type DocumentCoverStyle, type DocumentGutterSide, type DocumentLayout, type DocumentNode, type DocumentPageNumbers, type DocumentPaper, type DocumentSettings, type StudioDocument } from "@/types/studio";
import { normalizeSources } from "./bibtex";
import { CITATION_LANGUAGES, CITATION_STYLES } from "./citations";
import { HEADING_NUMBER_STYLES } from "./headingCounter";

export const DOCUMENT_PAPERS: DocumentPaper[] = ["a4", "a5", "b5", "letter", "legal"];
export const PAGE_NUMBER_PLACES: DocumentPageNumbers[] = ["none", "center", "right", "outside"];
export const GUTTER_SIDES: DocumentGutterSide[] = ["left", "top"];
export const DOCUMENT_ALIGNS: DocumentAlign[] = ["left", "center", "right"];
export const COVER_STYLES: DocumentCoverStyle[] = ["classic", "band", "frame", "minimal"];
export const DEFAULT_DOCUMENT_FONT = "bundled:dejavu-sans";

export const PAPER_POINTS: Record<DocumentPaper, { width: number; height: number }> = {
  a4: { width: 595, height: 842 },
  a5: { width: 420, height: 595 },
  b5: { width: 499, height: 709 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
};

export const POINTS_PER_MM = 72 / 25.4;
const COLOUR = /^#[0-9a-f]{6}$/i;
export const MIN_TEXT_MM = 20;
export const MARGIN_LIMITS = { margin: [5, 60], gutter: [0, 30] } as const;
const LIMITS = { columnGapMm: [4, 20], fontSize: [6, 28], lineHeight: [1, 3] } as const;
export const DOCUMENT_COLUMNS: DocumentColumns[] = [1, 2, 3];

export function defaultSettings(): DocumentSettings {
  return {
    paper: "a4",
    landscape: false,
    ...uniformMargins(20),
    gutterMm: 0,
    gutterSide: "left",
    columns: 1,
    columnGapMm: 8,
    fontSize: 11,
    lineHeight: 1.4,
    accent: "#1f4e79",
    header: "",
    headerAlign: "right",
    footer: "",
    footerAlign: "left",
    pageNumbers: "center",
    pageNumberFormat: "{n}",
    furnitureOnFirst: true,
    toc: false,
    tocTitle: "",
    tocDepth: 2,
    cover: false,
    coverStyle: "classic",
    title: "",
    subtitle: "",
    author: "",
    date: "",
    fontId: DEFAULT_DOCUMENT_FONT,
    headingFontId: null,
    headingNumbers: "none",
    citationStyle: "apa",
    citationLanguage: null,
    referencesTitle: "",
  };
}

export type DocumentMargins = Pick<DocumentSettings, "marginTopMm" | "marginBottomMm" | "marginLeftMm" | "marginRightMm">;

export function uniformMargins(mm: number): DocumentMargins {
  return { marginTopMm: mm, marginBottomMm: mm, marginLeftMm: mm, marginRightMm: mm };
}

export function uniformMargin(settings: DocumentMargins & Pick<DocumentSettings, "gutterMm">): number | null {
  const { marginTopMm, marginBottomMm, marginLeftMm, marginRightMm } = settings;
  return settings.gutterMm === 0 && marginTopMm === marginBottomMm && marginTopMm === marginLeftMm && marginTopMm === marginRightMm ? marginTopMm : null;
}

export function contentInsets(settings: DocumentMargins & Pick<DocumentSettings, "gutterMm" | "gutterSide">): { top: number; right: number; bottom: number; left: number } {
  const gutter = settings.gutterMm;
  return {
    top: (settings.marginTopMm + (settings.gutterSide === "top" ? gutter : 0)) * POINTS_PER_MM,
    right: settings.marginRightMm * POINTS_PER_MM,
    bottom: settings.marginBottomMm * POINTS_PER_MM,
    left: (settings.marginLeftMm + (settings.gutterSide === "left" ? gutter : 0)) * POINTS_PER_MM,
  };
}

export function createDocument(name: string, content: DocumentNode | string = "", settings: Partial<DocumentSettings> = {}): StudioDocument {
  return { version: STUDIO_DOCUMENT_VERSION, kind: "document", name, settings: { ...defaultSettings(), ...settings }, content, sources: [] };
}

export function pageSize(settings: Pick<DocumentSettings, "paper" | "landscape">): { width: number; height: number } {
  const size = PAPER_POINTS[settings.paper];
  return settings.landscape ? { width: size.height, height: size.width } : size;
}

function clamp(value: unknown, [low, high]: readonly [number, number], fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}

function text(value: unknown, fallback: string, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : fallback;
}

function pick<T extends string | number>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function fontId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 300 ? value : null;
}

export function normalizeSettings(value: unknown): DocumentSettings {
  const base = defaultSettings();
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const shared = clamp(source.marginMm, MARGIN_LIMITS.margin, base.marginTopMm);
  const margin = (side: unknown) => clamp(side, MARGIN_LIMITS.margin, shared);
  return {
    paper: pick(source.paper, DOCUMENT_PAPERS, base.paper),
    landscape: source.landscape === true,
    marginTopMm: margin(source.marginTopMm),
    marginBottomMm: margin(source.marginBottomMm),
    marginLeftMm: margin(source.marginLeftMm),
    marginRightMm: margin(source.marginRightMm),
    gutterMm: clamp(source.gutterMm, MARGIN_LIMITS.gutter, base.gutterMm),
    gutterSide: pick(source.gutterSide, GUTTER_SIDES, base.gutterSide),
    columns: pick(source.columns, DOCUMENT_COLUMNS, base.columns),
    columnGapMm: clamp(source.columnGapMm, LIMITS.columnGapMm, base.columnGapMm),
    fontSize: clamp(source.fontSize, LIMITS.fontSize, base.fontSize),
    lineHeight: clamp(source.lineHeight, LIMITS.lineHeight, base.lineHeight),
    accent: typeof source.accent === "string" && COLOUR.test(source.accent) ? source.accent : base.accent,
    header: text(source.header, "", 200),
    headerAlign: pick(source.headerAlign, DOCUMENT_ALIGNS, base.headerAlign),
    footer: text(source.footer, "", 200),
    footerAlign: pick(source.footerAlign, DOCUMENT_ALIGNS, base.footerAlign),
    pageNumbers: pick(source.pageNumbers, PAGE_NUMBER_PLACES, base.pageNumbers),
    pageNumberFormat: text(source.pageNumberFormat, base.pageNumberFormat, 40) || base.pageNumberFormat,
    furnitureOnFirst: source.furnitureOnFirst !== false,
    toc: source.toc === true,
    tocTitle: text(source.tocTitle, "", 100),
    tocDepth: pick(source.tocDepth, [1, 2, 3] as const, base.tocDepth),
    cover: source.cover === true,
    coverStyle: pick(source.coverStyle, COVER_STYLES, base.coverStyle),
    title: text(source.title, "", 300),
    subtitle: text(source.subtitle, "", 300),
    author: text(source.author, "", 300),
    date: text(source.date, "", 80),
    fontId: fontId(source.fontId) ?? base.fontId,
    headingFontId: fontId(source.headingFontId),
    headingNumbers: pick(source.headingNumbers, HEADING_NUMBER_STYLES, base.headingNumbers),
    citationStyle: pick(source.citationStyle, CITATION_STYLES, base.citationStyle),
    citationLanguage: CITATION_LANGUAGES.find((language) => language === source.citationLanguage) ?? null,
    referencesTitle: text(source.referencesTitle, "", 100),
  };
}

function isNode(value: unknown): value is DocumentNode {
  return Boolean(value) && typeof value === "object" && typeof (value as DocumentNode).type === "string";
}

export function normalizeDocument(value: unknown): StudioDocument | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (source.kind !== "document") return null;
  if (typeof source.version !== "number" || source.version > STUDIO_DOCUMENT_VERSION) return null;
  const content = typeof source.content === "string" || isNode(source.content) ? source.content : "";
  return { version: STUDIO_DOCUMENT_VERSION, kind: "document", name: text(source.name, "", 200), settings: normalizeSettings(source.settings), content, sources: normalizeSources(source.sources) };
}

export function layoutOf(settings: DocumentSettings, fallbackTocTitle: string): DocumentLayout {
  const layout: Partial<DocumentSettings> = { ...settings };
  delete layout.fontId;
  delete layout.headingFontId;
  delete layout.headingNumbers;
  delete layout.citationStyle;
  delete layout.citationLanguage;
  delete layout.referencesTitle;
  return { ...(layout as DocumentLayout), tocTitle: settings.tocTitle.trim() || fallbackTocTitle };
}

import type { BulkKind, CreateFont, CreateTemplate } from "@/types";

export const CREATE_TEMPLATES: CreateTemplate[] = ["report", "letter", "petition", "assignment", "minutes", "lectureNotes", "booklet"];
export const CREATE_FONTS: CreateFont[] = ["sans", "serif", "mono"];
export const CREATE_PAPERS = ["a4", "letter", "a5"] as const;
export type CreatePaper = (typeof CREATE_PAPERS)[number];
export const TEXT_SOURCE_EXTENSIONS = ["txt", "text", "md", "markdown"];
export const LOGO_EXTENSIONS = ["png", "jpg", "jpeg"];
export const DEFAULT_ACCENT = "#1f4e79";
export const CREATE_TABS = ["document", "book", "bulk", "paper"] as const;
export type CreateTab = (typeof CREATE_TABS)[number];
export const BULK_KINDS: BulkKind[] = ["certificate", "invitation", "badge"];
export const BULK_DATA_EXTENSIONS = ["csv", "tsv", "txt", "xlsx", "xlsm"];
export const MAX_SIGNERS = 3;
export const BULK_TEXT_FIELDS = ["heading", "recipient", "body", "details"] as const;
export type BulkTextField = (typeof BULK_TEXT_FIELDS)[number];
export type BulkTexts = Record<BulkTextField, string>;
const BULK_PRESET_FIELDS: Record<BulkKind, BulkTextField[]> = { certificate: ["heading", "body"], invitation: ["heading", "body"], badge: [] };

const SERIF_TEMPLATES = new Set<CreateTemplate>(["petition", "assignment", "booklet"]);

export function templateDefaults(template: CreateTemplate, paper: CreatePaper): { font: CreateFont; paper: CreatePaper; fontSize: number } {
  const font: CreateFont = SERIF_TEMPLATES.has(template) ? "serif" : "sans";
  const fontSize = template === "lectureNotes" ? 10.5 : template === "booklet" ? 10 : 11;
  if (template === "booklet") return { font, paper: "a5", fontSize };
  return { font, paper: paper === "a5" ? "a4" : paper, fontSize };
}

export function titleLabelKey(template: CreateTemplate): string {
  if (template === "petition") return "tools.create.fields.addressee";
  if (template === "letter") return "tools.create.fields.subject";
  return "tools.create.fields.title";
}

export function authorLabelKey(template: CreateTemplate): string {
  if (template === "minutes") return "tools.create.fields.attendees";
  if (template === "letter") return "tools.create.fields.sender";
  if (template === "petition") return "tools.create.fields.signer";
  return "tools.create.fields.author";
}

export function longDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function placeholderOf(column: string): string {
  return `{${column}}`;
}

export function withPlaceholder(text: string, column: string): string {
  const token = placeholderOf(column);
  if (!text) return token;
  return /\s$/.test(text) ? `${text}${token}` : `${text} ${token}`;
}

export function bulkPresetTexts(kind: BulkKind, translate: (key: string) => string): BulkTexts {
  const texts: BulkTexts = { heading: "", recipient: "", body: "", details: "" };
  for (const field of BULK_PRESET_FIELDS[kind]) texts[field] = translate(`tools.create.bulk.kinds.${kind}.${field}`);
  return texts;
}

import { Contact, FileText, IdCard, LayoutTemplate, Palette, Sparkles, type LucideIcon } from "lucide-react";
import type { StudioSection } from "./studioSection";

export const SECTION_ICONS: Record<StudioSection, LucideIcon> = {
  home: Sparkles,
  document: FileText,
  design: Palette,
  card: Contact,
  cv: IdCard,
  templates: LayoutTemplate,
};

export const SECTION_TONES: Record<StudioSection, string | undefined> = {
  home: undefined,
  document: "organize",
  design: "fromPdf",
  card: "improve",
  cv: "toPdf",
  templates: "edit",
};

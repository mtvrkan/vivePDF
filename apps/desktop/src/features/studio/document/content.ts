import type { TFunction } from "i18next";
import type { StudioDocument, StudioDocumentContent } from "@/types/studio";
import { citationTerms } from "./citationSource";
import { buildCitations, type CitationTerms } from "./citations";
import { layoutOf } from "./model";
import { documentHtml } from "./toHtml";

export type DocumentText = { tocTitle: string; referencesTitle: string; terms: CitationTerms };

export function documentText(t: TFunction): DocumentText {
  return { tocTitle: t("studio.doc.settings.tocTitleDefault"), referencesTitle: t("studio.doc.cite.referencesDefault"), terms: citationTerms(t) };
}

export function documentContent(document: StudioDocument, language: string, text: DocumentText): StudioDocumentContent {
  const node = typeof document.content === "string" ? { type: "doc", content: [] } : document.content;
  const citations = buildCitations(node, document.sources, document.settings.citationStyle, text.terms, language);
  const { html, images, fonts } = documentHtml(node, document.settings, { citations, title: document.settings.referencesTitle.trim() || text.referencesTitle });
  return { html, images, fonts, settings: layoutOf(document.settings, text.tocTitle), title: document.name, language };
}

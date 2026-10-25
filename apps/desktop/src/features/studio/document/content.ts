import type { StudioDocument, StudioDocumentContent } from "@/types/studio";
import { citationLanguageOf } from "./citations";
import { buildCitations } from "./cslEngine";
import { layoutOf } from "./model";
import { documentHtml } from "./toHtml";
import type { DocumentText } from "./documentText";

export { documentText, type DocumentText } from "./documentText";

export async function documentContent(document: StudioDocument, language: string, text: DocumentText): Promise<StudioDocumentContent> {
  const node = typeof document.content === "string" ? { type: "doc", content: [] } : document.content;
  const citations = await buildCitations(node, document.sources, document.settings.citationStyle, citationLanguageOf(document.settings.citationLanguage, language));
  const { html, images, fonts, footnotes, footnoteHtml } = documentHtml(node, document.settings, { citations, title: document.settings.referencesTitle.trim() || text.referencesTitle });
  return { html, images, fonts, footnotes, footnoteHtml, notesTitle: text.notesTitle, settings: layoutOf(document.settings, text.tocTitle), title: document.name, language };
}

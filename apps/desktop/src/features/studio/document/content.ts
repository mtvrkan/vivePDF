import type { StudioDocument, StudioDocumentContent } from "@/types/studio";
import { citationLanguageOf } from "./citations";
import { buildCitations } from "./cslEngine";
import { layoutOf } from "./model";
import { documentHtml } from "./toHtml";
import type { DocumentText } from "./documentText";

export { documentText, type DocumentText } from "./documentText";

export async function documentContent(document: StudioDocument, language: string, text: DocumentText): Promise<StudioDocumentContent> {
  return (await laidOutContent(document, language, text, false)).content;
}

export async function laidOutContent(document: StudioDocument, language: string, text: DocumentText, markBlocks = true): Promise<{ content: StudioDocumentContent; blockIds: string[] }> {
  const node = typeof document.content === "string" ? { type: "doc", content: [] } : document.content;
  const citations = await buildCitations(node, document.sources, document.settings.citationStyle, citationLanguageOf(document.settings.citationLanguage, language));
  const { html, images, equations, fonts, footnotes, footnoteHtml, blockIds } = documentHtml(node, document.settings, { citations, title: document.settings.referencesTitle.trim() || text.referencesTitle }, markBlocks);
  return { content: { html, images, equations, fonts, footnotes, footnoteHtml, notesTitle: text.notesTitle, settings: layoutOf(document.settings, text.tocTitle, { figure: text.figureListTitle, table: text.tableListTitle }), title: document.name, language }, blockIds };
}

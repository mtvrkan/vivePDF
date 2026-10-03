import type { StudioDocument, StudioDocumentContent } from "@/types/studio";
import { layoutOf } from "./model";
import { documentHtml } from "./toHtml";

export function documentContent(document: StudioDocument, language: string, tocTitle: string): StudioDocumentContent {
  const node = typeof document.content === "string" ? { type: "doc", content: [] } : document.content;
  const { html, images, fonts } = documentHtml(node, document.settings);
  return { html, images, fonts, settings: layoutOf(document.settings, tocTitle), title: document.name, language };
}

import type { TFunction } from "i18next";
import type { BibEntry, CitationStyle, DocumentNode } from "@/types/studio";
import type { CitationSource } from "./citationNodes";
import { buildCitations, type Citations, type CitationTerms } from "./citations";
import { useDocumentStore } from "./documentStore";

const TERM_KEYS: (keyof CitationTerms)[] = ["and", "etAl", "page", "pages", "noDate", "in", "editor", "editors", "editedBy", "edition", "volume", "issue", "doctoral", "masters", "thesis", "report", "available"];

export function citationTerms(t: TFunction): CitationTerms {
  return Object.fromEntries(TERM_KEYS.map((key) => [key, t(`studio.doc.cite.terms.${key}`)])) as CitationTerms;
}

export function storeCitationSource(terms: CitationTerms, locale: string, fallbackTitle: string, emptyText: string): CitationSource {
  let cache: { content: DocumentNode | string; sources: BibEntry[]; style: CitationStyle; value: Citations } | null = null;
  const current = () => {
    const document = useDocumentStore.getState().document;
    const content = document?.content ?? "";
    const sources = document?.sources ?? [];
    const style = document?.settings.citationStyle ?? "apa";
    if (!cache || cache.content !== content || cache.sources !== sources || cache.style !== style) {
      cache = { content, sources, style, value: buildCitations(content, sources, style, terms, locale) };
    }
    return cache.value;
  };
  return {
    current,
    title: () => useDocumentStore.getState().document?.settings.referencesTitle.trim() || fallbackTitle,
    emptyText,
    subscribe: (listener) =>
      useDocumentStore.subscribe((state, previous) => {
        if (state.document !== previous.document) listener();
      }),
  };
}

import * as logger from "@/shared/lib/logger";
import type { CitationSource } from "./citationNodes";
import { citationLanguageOf, pendingCitations } from "./citations";
import { loadCitationEngine, readyCitationEngine } from "./cslEngine";
import { useDocumentStore } from "./documentStore";

export function storeCitationSource(language: string, fallbackTitle: string, emptyText: string): CitationSource {
  const listeners = new Set<() => void>();
  const waiting = new Set<string>();
  const current = () => {
    const document = useDocumentStore.getState().document;
    const style = document?.settings.citationStyle ?? "apa";
    const reference = citationLanguageOf(document?.settings.citationLanguage, language);
    const engine = readyCitationEngine(style, reference);
    if (!engine) {
      const key = `${style}|${reference}`;
      if (!waiting.has(key)) {
        waiting.add(key);
        loadCitationEngine(style, reference).then(
          () => {
            waiting.delete(key);
            listeners.forEach((listener) => listener());
          },
          (caught: unknown) => {
            waiting.delete(key);
            logger.error("citations", logger.describeError(caught));
          },
        );
      }
      return pendingCitations(style);
    }
    return engine.citations(document?.content ?? "", document?.sources ?? []);
  };
  return {
    current,
    title: () => useDocumentStore.getState().document?.settings.referencesTitle.trim() || fallbackTitle,
    emptyText,
    subscribe: (listener) => {
      listeners.add(listener);
      const stop = useDocumentStore.subscribe((state, previous) => {
        if (state.document !== previous.document) listener();
      });
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
  };
}

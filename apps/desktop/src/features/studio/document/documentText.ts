import type { TFunction } from "i18next";

export type DocumentText = { tocTitle: string; referencesTitle: string; notesTitle: string };

export function documentText(t: TFunction): DocumentText {
  return { tocTitle: t("studio.doc.settings.tocTitleDefault"), referencesTitle: t("studio.doc.cite.referencesDefault"), notesTitle: t("studio.doc.footnotes.endTitle") };
}

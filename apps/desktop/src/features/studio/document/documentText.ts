import type { TFunction } from "i18next";

export type DocumentText = { tocTitle: string; referencesTitle: string; notesTitle: string; figureListTitle?: string; tableListTitle?: string };

export function documentText(t: TFunction): DocumentText {
  return {
    tocTitle: t("studio.doc.settings.tocTitleDefault"),
    referencesTitle: t("studio.doc.cite.referencesDefault"),
    notesTitle: t("studio.doc.footnotes.endTitle"),
    figureListTitle: t("studio.doc.caption.figureList"),
    tableListTitle: t("studio.doc.caption.tableList"),
  };
}

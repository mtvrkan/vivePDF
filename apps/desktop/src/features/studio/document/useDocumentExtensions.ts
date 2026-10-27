import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { StudioDocument } from "@/types/studio";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";

export function useDocumentExtensions(language: string, fixed?: StudioDocument) {
  const { t } = useTranslation();
  return useMemo(() => documentExtensions(t("studio.doc.placeholder"), storeCitationSource(language, t("studio.doc.cite.referencesDefault"), t("studio.doc.cite.emptyList"), fixed), (columns, continuous) => t(continuous ? "studio.doc.section.labelContinuous" : "studio.doc.section.label", { columns }), t("studio.doc.mainMatter.label")), [t, language, fixed]);
}

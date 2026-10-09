import type { TFunction } from "i18next";
import type { Locale } from "@/types";
import { useCvStore } from "./cv/cvStore";
import { useStudioStore } from "./design/studioStore";
import { useDocumentStore } from "./document/documentStore";
import { buildStarter } from "./document/starters";
import { createCardDesign } from "./model/cards";

export const STUDIO_STARTS = ["cv", "card", "document", "sources"] as const;
export type StudioStartLink = (typeof STUDIO_STARTS)[number];

export function studioStartOf(params: URLSearchParams): StudioStartLink | null {
  if (params.get("cv") === "1") return "cv";
  const start = params.get("start");
  return STUDIO_STARTS.find((item) => item === start) ?? null;
}

export function withoutStudioStart(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("cv");
  next.delete("start");
  return next;
}

export function launchStudioStart(start: StudioStartLink, t: TFunction, language: Locale) {
  if (start === "cv") {
    useCvStore.getState().open(language);
    return;
  }
  const designOpen = useStudioStore.getState().design !== null;
  const documents = useDocumentStore.getState();
  if (designOpen) return;
  if (start === "card") {
    if (documents.document === null) useStudioStore.getState().open(createCardDesign("businessCardEu", { front: t("studio.page.front"), back: t("studio.page.back") }));
    return;
  }
  if (documents.document === null) documents.open(buildStarter("blank", t, language));
  if (start === "sources") useDocumentStore.getState().requestSources(true);
}

import type { TFunction } from "i18next";
import { useToastStore } from "@/shared/store/toastStore";
import { MAX_SOURCES, type BibParseResult } from "./bibtex";

export function reportParseNotices(t: TFunction, parsed: BibParseResult) {
  const push = useToastStore.getState().push;
  if (parsed.skipped > 0) push("info", t("studio.doc.cite.skipped", { skipped: parsed.skipped }));
  if (parsed.duplicates > 0) push("info", t("studio.doc.cite.duplicates", { count: parsed.duplicates }));
  if (parsed.truncated) push("info", t("studio.doc.cite.truncated", { count: parsed.truncated, limit: MAX_SOURCES }));
  if (parsed.clipped) push("info", t("studio.doc.cite.clipped", { count: parsed.clipped }));
}

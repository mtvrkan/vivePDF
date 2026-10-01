import { MAX_AUTHOR_LENGTH } from "@/shared/store/preferencesStore";

export const DEFAULT_ANNOTATION_AUTHOR = "vivePDF";

export function annotationAuthorName(preference: string): string {
  const name = preference.split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_AUTHOR_LENGTH).trim();
  return name || DEFAULT_ANNOTATION_AUTHOR;
}

import { stemOf } from "@/shared/lib/paths";
import type { CoverStyle, SourceDocument } from "@/types";

export const COVER_STYLES: CoverStyle[] = ["classic", "band", "frame", "minimal", "photo"];
export const COVER_PHOTO_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
export const COVER_TEXT_FIELDS = ["title", "subtitle", "organisation", "author", "details", "date"] as const;
export type CoverTextField = (typeof COVER_TEXT_FIELDS)[number];
export type CoverTexts = Record<CoverTextField, string>;

export function coverDefaults(source: SourceDocument | null): Pick<CoverTexts, "title" | "author"> {
  const metadata = source?.info?.metadata ?? {};
  const title = metadata.title?.trim() || (source ? stemOf(source.path) : "");
  return { title, author: metadata.author?.trim() ?? "" };
}

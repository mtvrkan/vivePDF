export type TocHeading = { depth: number; slug: string; text: string };

export function headingId(text: string, locale: string): string {
  return text
    .toLocaleLowerCase(locale)
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

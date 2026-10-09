export const CITATION = "citation";
export const BIBLIOGRAPHY = "bibliography";
export const MAX_CITED = 50;
const MAX_LOCATOR = 40;

export type CitationItem = { key: string; locator: string };

export function citationItems(value: unknown): CitationItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_CITED)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).key === "string")
    .map((item) => ({ key: String(item.key).slice(0, 200), locator: typeof item.locator === "string" ? item.locator.slice(0, MAX_LOCATOR) : "" }));
}

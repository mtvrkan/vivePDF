import { basenameOf, dirnameOf, extensionOf } from "@/shared/lib/paths";

export const COLLECTION_SORTS = ["collection", "nameAsc", "nameDesc", "folder", "type"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export function matchingPaths(paths: string[], query: string, locale: string): string[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (!needle) return paths;
  return paths.filter((path) => path.toLocaleLowerCase(locale).includes(needle));
}

export function sortedPaths(paths: string[], sort: CollectionSort, locale: string): string[] {
  if (sort === "collection") return paths;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const byName = (a: string, b: string) => collator.compare(basenameOf(a), basenameOf(b));
  const compare: Record<Exclude<CollectionSort, "collection">, (a: string, b: string) => number> = {
    nameAsc: byName,
    nameDesc: (a, b) => byName(b, a),
    folder: (a, b) => collator.compare(dirnameOf(a), dirnameOf(b)) || byName(a, b),
    type: (a, b) => collator.compare(extensionOf(a), extensionOf(b)) || byName(a, b),
  };
  return [...paths].sort(compare[sort]);
}

import { normalizeText } from "@/components/layout/paletteMatch";
import { dirnameOf } from "@/shared/lib/paths";
import type { RecentSort } from "@/shared/store/recentStore";
import type { RecentFile } from "@/types";

export function matchingRecent(items: RecentFile[], query: string, locale: string): RecentFile[] {
  const needle = normalizeText(query, locale);
  if (!needle) return items;
  return items.filter((item) => normalizeText(`${item.fileName} ${dirnameOf(item.path)}`, locale).includes(needle));
}

export function sortedRecent(items: RecentFile[], sort: RecentSort, locale: string): RecentFile[] {
  if (sort === "recent") return items;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const byName = (a: RecentFile, b: RecentFile) => collator.compare(a.fileName, b.fileName);
  if (sort === "name") return [...items].sort(byName);
  return [...items].sort((a, b) => collator.compare(dirnameOf(a.path), dirnameOf(b.path)) || byName(a, b));
}

export function pinnedFirst(items: RecentFile[]): RecentFile[] {
  return [...items.filter((item) => item.pinned === true), ...items.filter((item) => item.pinned !== true)];
}

import { isCardPage } from "../model/cards";
import type { TemplateFilter } from "./categories";
import { sizeOf, type StudioTemplate, type TemplateCategory } from "./kit";

export type PageSize = { width: number; height: number };

const SAME_SIZE_TOLERANCE = 0.5;

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_SIZE_TOLERANCE;
}

export function fitsPage(template: StudioTemplate, page: PageSize): boolean {
  const size = sizeOf(template.size);
  if (isCardPage(page)) return isCardPage(size);
  return (same(size.width, page.width) && same(size.height, page.height)) || (same(size.width, page.height) && same(size.height, page.width));
}

export function filterForPage(templates: readonly StudioTemplate[], page: PageSize | null | undefined): TemplateFilter {
  if (!page) return "all";
  const counts = new Map<TemplateCategory, number>();
  let fitting = 0;
  for (const template of templates) {
    if (!fitsPage(template, page)) continue;
    fitting += 1;
    counts.set(template.category, (counts.get(template.category) ?? 0) + 1);
  }
  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  return best && best[1] * 2 > fitting ? best[0] : "all";
}

export function fittingFirst(templates: readonly StudioTemplate[], page: PageSize | null | undefined): StudioTemplate[] {
  if (!page) return [...templates];
  return [...templates.filter((template) => fitsPage(template, page)), ...templates.filter((template) => !fitsPage(template, page))];
}

export type PageLabels = readonly string[] | null;

export function pageLabelOf(labels: PageLabels, page: number): string {
  return labels?.[page - 1] || String(page);
}

export function pageFromInput(input: string, labels: PageLabels, total: number): number | null {
  const text = input.trim();
  if (!text) return null;
  if (labels) {
    const exact = labels.indexOf(text);
    if (exact >= 0) return exact + 1;
    const folded = text.toLocaleLowerCase();
    const loose = labels.findIndex((label) => label.toLocaleLowerCase() === folded);
    if (loose >= 0) return loose + 1;
  }
  if (!/^\d+$/.test(text)) return null;
  const page = Number(text);
  return page >= 1 && page <= total ? page : null;
}

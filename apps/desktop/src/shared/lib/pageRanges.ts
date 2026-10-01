export function pagesInRanges(spec: string, pageCount: number): number | null {
  const trimmed = spec.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return pageCount;
  let total = 0;
  for (const piece of trimmed.split(",")) {
    const part = piece.trim();
    if (!part) return null;
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!match) return null;
    const [, rawFirst, dash, rawLast] = match;
    if (!rawFirst && !rawLast) return null;
    const first = rawFirst ? Number(rawFirst) : 1;
    const last = dash ? (rawLast ? Number(rawLast) : pageCount) : first;
    if (first < 1 || last < 1 || first > pageCount || last > pageCount) return null;
    total += Math.abs(last - first) + 1;
  }
  return total;
}

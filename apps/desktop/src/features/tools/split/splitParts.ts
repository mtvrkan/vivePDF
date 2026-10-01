export type SplitPart = { label: string; pages: number | null };

type Bound = { first: number; last: number | null };

function parseRange(piece: string, pageCount: number | null): Bound | null {
  const trimmed = piece.trim();
  if (!trimmed) return null;
  const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(trimmed);
  if (!match) return null;
  const [, rawFirst, dash, rawLast] = match;
  if (!rawFirst && !rawLast) return null;
  const first = rawFirst ? Number(rawFirst) : 1;
  const last = dash ? (rawLast ? Number(rawLast) : pageCount) : first;
  if (first < 1) return null;
  if (last !== null && last < 1) return null;
  if (pageCount !== null && (first > pageCount || (last !== null && last > pageCount))) return null;
  return { first, last };
}

export function splitParts(spec: string, pageCount: number | null): SplitPart[] | null {
  if (pageCount !== null && pageCount < 1) return null;
  const pieces = spec.split(";").filter((piece) => piece.trim().length > 0);
  if (pieces.length === 0) return null;
  const parts: SplitPart[] = [];
  for (const piece of pieces) {
    const bounds: Bound[] = [];
    for (const range of piece.split(",")) {
      const found = parseRange(range, pageCount);
      if (!found) return null;
      bounds.push(found);
    }
    const first = bounds[0].first;
    const last = bounds[bounds.length - 1].last;
    const open = bounds.some((bound) => bound.last === null);
    parts.push({
      label: last === null ? `${first}-` : first === last && bounds.length === 1 ? `${first}` : `${first}-${last}`,
      pages: open ? null : countOf(bounds),
    });
  }
  return parts;
}

function countOf(bounds: Bound[]): number {
  return bounds.reduce((total, bound) => total + Math.abs((bound.last ?? bound.first) - bound.first) + 1, 0);
}

export function cutsToRanges(starts: number[], pageCount: number): string {
  const firsts = [...new Set([1, ...starts.filter((page) => page > 1 && page <= pageCount)])].sort((left, right) => left - right);
  return firsts
    .map((first, index) => {
      const last = index + 1 < firsts.length ? firsts[index + 1] - 1 : pageCount;
      return first === last ? `${first}` : `${first}-${last}`;
    })
    .join("; ");
}

export function rangesToCuts(spec: string, pageCount: number): number[] {
  const pieces = spec.split(";").map((piece) => piece.trim()).filter(Boolean);
  const starts: number[] = [];
  let next = 1;
  for (const piece of pieces) {
    const bound = parseRange(piece, pageCount);
    if (!bound || piece.includes(",") || bound.first !== next) return [];
    const last = bound.last ?? pageCount;
    if (last < bound.first) return [];
    if (bound.first > 1) starts.push(bound.first);
    next = last + 1;
  }
  return next === pageCount + 1 ? starts : [];
}

export function textSplitPattern(query: string, regex: boolean): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  if (regex) return trimmed;
  return `(${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*)`;
}

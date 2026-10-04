import { rpc, type RpcCallOptions } from "./client";

export type PageAnalysis = {
  index: number;
  blank: boolean;
  scanned: boolean;
  hasText: boolean;
  textChars: number;
  imageCoverage: number;
  inkRatio: number;
};

export type AnalyzeResult = {
  pageCount: number;
  pages: PageAnalysis[];
  blankPages: number[];
  scannedPages: number[];
};

export type AnalyzeParams = { path: string; password?: string; pages?: string };

export const analyzePages = (params: AnalyzeParams, options?: RpcCallOptions) => rpc<AnalyzeResult>("pages.analyze", params, options);

export type DuplicateSource = { path: string; password?: string };

export type DuplicatesParams = { sources: DuplicateSource[] };

export type DuplicatesResult = { pageCounts: number[]; groups: Array<Array<number | null>>; groupCount: number };

export const findDuplicatePages = (params: DuplicatesParams, options?: RpcCallOptions) => rpc<DuplicatesResult>("pages.duplicates", params, options);

export function rangesOf(indices: number[]): string {
  const sorted = [...indices].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  for (const index of sorted) {
    const page = index + 1;
    if (start === null || previous === null) {
      start = page;
      previous = page;
      continue;
    }
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = page;
    previous = page;
  }
  if (start !== null && previous !== null) parts.push(start === previous ? `${start}` : `${start}-${previous}`);
  return parts.join(", ");
}

import type { PageText } from "@/types";

export type FetchPageTexts = (pages: number[]) => Promise<PageText[]>;
export type PageBatchLoader<T> = { cached: (page: number) => T | undefined; request: (page: number) => Promise<T> };
export type PageTextLoader = PageBatchLoader<string>;

export const PAGE_TEXT_BATCH_DELAY_MS = 120;
export const PAGE_TEXT_CACHE_LIMIT = 200;

type Waiter<T> = { resolve: (value: T) => void; reject: (reason: unknown) => void };

export function createPageBatchLoader<T>(
  fetchPages: (pages: number[]) => Promise<Map<number, T>>,
  fallback: T,
  delayMs = PAGE_TEXT_BATCH_DELAY_MS,
  limit = PAGE_TEXT_CACHE_LIMIT,
): PageBatchLoader<T> {
  const values = new Map<number, T>();
  const waiting = new Map<number, Waiter<T>[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const remember = (page: number, value: T) => {
    values.delete(page);
    values.set(page, value);
    if (values.size > limit) {
      const oldest = values.keys().next().value;
      if (oldest !== undefined) values.delete(oldest);
    }
  };

  const flush = () => {
    timer = null;
    const batch = new Map(waiting);
    waiting.clear();
    const pages = Array.from(batch.keys()).sort((a, b) => a - b);
    fetchPages(pages).then(
      (found) => {
        batch.forEach((waiters, page) => {
          const value = found.get(page) ?? fallback;
          remember(page, value);
          waiters.forEach((waiter) => waiter.resolve(value));
        });
      },
      (reason: unknown) => batch.forEach((waiters) => waiters.forEach((waiter) => waiter.reject(reason))),
    );
  };

  return {
    cached: (page) => values.get(page),
    request: (page) => {
      const known = values.get(page);
      if (known !== undefined) return Promise.resolve(known);
      return new Promise<T>((resolve, reject) => {
        const list = waiting.get(page) ?? [];
        list.push({ resolve, reject });
        waiting.set(page, list);
        if (timer === null) timer = setTimeout(flush, delayMs);
      });
    },
  };
}

export function createPageTextLoader(fetchTexts: FetchPageTexts, delayMs = PAGE_TEXT_BATCH_DELAY_MS, limit = PAGE_TEXT_CACHE_LIMIT): PageTextLoader {
  return createPageBatchLoader(async (pages) => new Map((await fetchTexts(pages)).map((entry) => [entry.page, entry.text])), "", delayMs, limit);
}

export function accessibleParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(?<![.:;!?])\n(?=[^\s•])/g, " ")
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

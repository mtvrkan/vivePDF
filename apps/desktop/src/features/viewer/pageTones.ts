import { useEffect, useState, type CSSProperties } from "react";
import { DARK_FILTER } from "@/shared/lib/pageColors";
import { getPageTones } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { PageTone } from "@/types";
import { createPageBatchLoader, type PageBatchLoader } from "./pageTextLoader";

type LoaderEntry = { source: string; loader: PageBatchLoader<PageTone | null> };

const LOADER_LIMIT = 8;
const loaders = new Map<string, LoaderEntry>();

export function toneLoaderFor(documentId: string, path: string, password: string | null): PageBatchLoader<PageTone | null> {
  const source = JSON.stringify([path, password]);
  const known = loaders.get(documentId);
  if (known && known.source === source) return known.loader;
  const loader = createPageBatchLoader<PageTone | null>(async (pages) => {
    const result = await getPageTones({ path, password: password ?? undefined, pages: pages.join(",") });
    return new Map(result.pages.map((tone) => [tone.page, tone]));
  }, null);
  loaders.delete(documentId);
  loaders.set(documentId, { source, loader });
  if (loaders.size > LOADER_LIMIT) {
    const oldest = loaders.keys().next().value;
    if (oldest !== undefined) loaders.delete(oldest);
  }
  return loader;
}

export function usePageTone(documentId: string, pageIndex: number, enabled: boolean): PageTone | null {
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const password = useDocumentStore((state) => state.documents[documentId]?.password ?? null);
  const page = pageIndex + 1;
  const [tone, setTone] = useState<PageTone | null>(() => (enabled && path ? (toneLoaderFor(documentId, path, password).cached(page) ?? null) : null));

  useEffect(() => {
    if (!enabled || !path) {
      setTone(null);
      return;
    }
    const loader = toneLoaderFor(documentId, path, password);
    const known = loader.cached(page);
    if (known !== undefined) {
      setTone(known);
      return;
    }
    setTone(null);
    let active = true;
    loader.request(page).then(
      (loaded) => {
        if (active) setTone(loaded);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [documentId, path, password, page, enabled]);

  return tone;
}

export function darkPageStyle(tone: PageTone | null, filterId: string): CSSProperties | undefined {
  if (tone?.dark) return undefined;
  if (tone && tone.pictures.length > 0) return { filter: `url(#${filterId})` };
  return { filter: DARK_FILTER };
}

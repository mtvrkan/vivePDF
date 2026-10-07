import { getPageText } from "@/shared/rpc/operations";
import { createPageTextLoader, type PageTextLoader } from "./pageTextLoader";

type LoaderEntry = { source: string; loader: PageTextLoader };

const LOADER_LIMIT = 8;
const loaders = new Map<string, LoaderEntry>();
const versions = new Map<string, number>();
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function invalidatePageText(documentId: string) {
  loaders.delete(documentId);
  versions.set(documentId, (versions.get(documentId) ?? 0) + 1);
  listeners.forEach((listener) => listener());
}

export function loaderFor(documentId: string, path: string, password: string | null): PageTextLoader {
  const source = JSON.stringify([path, password]);
  const known = loaders.get(documentId);
  if (known && known.source === source) return known.loader;
  const loader = createPageTextLoader(async (pages) => {
    const result = await getPageText({ path, password: password ?? undefined, pages: pages.join(",") });
    return result.pages;
  });
  loaders.delete(documentId);
  loaders.set(documentId, { source, loader });
  if (loaders.size > LOADER_LIMIT) {
    const oldest = loaders.keys().next().value;
    if (oldest !== undefined) loaders.delete(oldest);
  }
  return loader;
}


export function versionOf(documentId: string): number {
  return versions.get(documentId) ?? 0;
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getPageText } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { accessibleParagraphs, createPageTextLoader, type PageTextLoader } from "./pageTextLoader";

type LoaderEntry = { source: string; loader: PageTextLoader };

const LOADER_LIMIT = 8;
const loaders = new Map<string, LoaderEntry>();

function loaderFor(documentId: string, path: string, password: string | null): PageTextLoader {
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

export function PageTextLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const { t } = useTranslation();
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const password = useDocumentStore((state) => state.documents[documentId]?.password ?? null);
  const hostRef = useRef<HTMLDivElement>(null);
  const page = pageIndex + 1;
  const [text, setText] = useState<string | null>(() => (path ? (loaderFor(documentId, path, password).cached(page) ?? null) : null));

  useEffect(() => {
    const host = hostRef.current;
    if (!path || !host) return;
    const loader = loaderFor(documentId, path, password);
    const known = loader.cached(page);
    setText(known ?? null);
    if (known !== undefined) return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      loader.request(page).then(
        (loaded) => {
          if (active) setText(loaded);
        },
        () => undefined,
      );
    });
    observer.observe(host);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [documentId, path, password, page]);

  const paragraphs = text === null ? [] : accessibleParagraphs(text);
  return (
    <div ref={hostRef} data-page-text="" className="pointer-events-none absolute inset-0 select-none" aria-hidden={text === null ? true : undefined}>
      {text !== null && (
        <div className="sr-only">
          <h2>{t("viewer.pageText.heading", { page })}</h2>
          {paragraphs.length === 0 ? <p>{t("viewer.pageText.empty")}</p> : paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
      )}
    </div>
  );
}

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentStore } from "@/shared/store/documentStore";
import { accessibleParagraphs } from "./pageTextLoader";
import { loaderFor, subscribe, versionOf } from "./pageTextCache";

const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 1500;
export const PAGE_TEXT_DWELL_MS = 250;

export const PageTextLayer = memo(function PageTextLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const { t } = useTranslation();
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const password = useDocumentStore((state) => state.documents[documentId]?.password ?? null);
  const version = useSyncExternalStore(subscribe, () => versionOf(documentId));
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
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    const load = (attempt: number) => {
      loader.request(page).then(
        (loaded) => {
          if (active) setText(loaded);
        },
        () => {
          if (active && attempt < RETRY_LIMIT) retryTimer = setTimeout(() => load(attempt + 1), RETRY_DELAY_MS * attempt);
        },
      );
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        if (dwellTimer !== null) clearTimeout(dwellTimer);
        dwellTimer = null;
        return;
      }
      if (dwellTimer !== null) return;
      dwellTimer = setTimeout(() => {
        dwellTimer = null;
        observer.disconnect();
        load(1);
      }, PAGE_TEXT_DWELL_MS);
    });
    observer.observe(host);
    return () => {
      active = false;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (dwellTimer !== null) clearTimeout(dwellTimer);
      observer.disconnect();
    };
  }, [documentId, path, password, page, version]);

  const paragraphs = useMemo(() => (text === null ? [] : accessibleParagraphs(text)), [text]);
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
});

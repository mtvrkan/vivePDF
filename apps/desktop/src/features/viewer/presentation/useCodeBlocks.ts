import { useEffect, useRef } from "react";
import { getCodeBlocks } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore } from "@/shared/store/presentationStore";

const DEBOUNCE_MS = 250;

export function useCodeBlocksForPage(documentId: string, pageIndex: number) {
  const document = useDocumentStore((state) => state.documents[documentId]);
  const cached = usePresentationStore((state) => state.codeBlocksByPage[pageIndex]);
  const setCodeBlocksForPage = usePresentationStore((state) => state.setCodeBlocksForPage);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!document || cached) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void getCodeBlocks({ path: document.path, password: document.password ?? undefined, page: pageIndex })
        .then((result) => setCodeBlocksForPage(pageIndex, result))
        .catch(() => void 0);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [document, pageIndex, cached, setCodeBlocksForPage]);

  return cached ?? null;
}

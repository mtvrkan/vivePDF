import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRegistry } from "@embedpdf/core/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useReadingPositionStore } from "@/shared/store/readingPositionStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerJumpStore } from "@/shared/store/viewerJumpStore";
import { usePageNavigation } from "./usePageNavigation";

const ARM_GRACE_MS = 10000;
const handledDocuments = new Set<string>();
const restoreTargets = new Map<string, { page: number; until: number }>();

export function ReadingPositionTracker({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const { state } = useScroll(documentId);
  const { documents } = useRegistry();
  const pageCount = documents[documentId]?.document?.pageCount ?? 0;
  const { jumpTo } = usePageNavigation(documentId);
  const jumpRef = useRef(jumpTo);
  jumpRef.current = jumpTo;
  const { currentPage, totalPages } = state;

  useEffect(() => {
    if (!path || pageCount === 0 || totalPages === 0 || handledDocuments.has(documentId)) return;
    handledDocuments.add(documentId);
    const pending = useViewerJumpStore.getState().pending;
    if (pending && pending.path === path) return;
    const saved = useReadingPositionStore.getState().positionOf(path);
    if (saved === null || saved <= 1 || saved > pageCount) return;
    restoreTargets.set(documentId, { page: saved, until: Date.now() + ARM_GRACE_MS });
    useViewerJumpStore.getState().request({ path, page: saved });
    useToastStore.getState().push("info", t("viewer.resume.toast"), {
      label: t("viewer.resume.fromStart"),
      onClick: () => jumpRef.current(1),
    });
  }, [documentId, path, pageCount, totalPages, t]);

  useEffect(() => {
    if (!path || totalPages !== pageCount || !handledDocuments.has(documentId)) return;
    const restore = restoreTargets.get(documentId);
    if (restore) {
      if (currentPage !== restore.page && Date.now() < restore.until) return;
      restoreTargets.delete(documentId);
    }
    useReadingPositionStore.getState().remember(path, currentPage);
  }, [documentId, path, currentPage, totalPages, pageCount]);

  return null;
}

import { useCallback } from "react";
import type { PdfLinkTarget } from "@embedpdf/models";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { navStacksFor, useNavHistoryStore } from "@/shared/store/navHistoryStore";

export function usePageNavigation(documentId: string) {
  const { provides: scroll } = useScroll(documentId);
  const { provides: annotation } = useAnnotation(documentId);
  const canGoBack = useNavHistoryStore((state) => navStacksFor(state.stacks, documentId).back.length > 0);
  const canGoForward = useNavHistoryStore((state) => navStacksFor(state.stacks, documentId).forward.length > 0);

  const currentPage = useCallback(() => scroll?.getCurrentPage() ?? 1, [scroll]);

  const jumpTo = useCallback(
    (pageNumber: number) => {
      if (!scroll) return;
      const total = Math.max(1, scroll.getTotalPages());
      const target = Math.min(Math.max(1, Math.round(pageNumber)), total);
      useNavHistoryStore.getState().record(documentId, currentPage(), target);
      scroll.scrollToPage({ pageNumber: target, behavior: "instant" });
    },
    [scroll, documentId, currentPage],
  );

  const followLink = useCallback(
    (target: PdfLinkTarget, pageIndex: number) => {
      if (!scroll) return;
      useNavHistoryStore.getState().record(documentId, currentPage(), pageIndex + 1);
      const fallback = () => scroll.scrollToPage({ pageNumber: pageIndex + 1 });
      if (!annotation) {
        fallback();
        return;
      }
      annotation.navigateTarget(target).wait((result) => {
        if (result.outcome !== "navigated") fallback();
      }, fallback);
    },
    [scroll, annotation, documentId, currentPage],
  );

  const goBack = useCallback(() => {
    const page = useNavHistoryStore.getState().back(documentId, currentPage());
    if (page !== null) scroll?.scrollToPage({ pageNumber: page });
  }, [scroll, documentId, currentPage]);

  const goForward = useCallback(() => {
    const page = useNavHistoryStore.getState().forward(documentId, currentPage());
    if (page !== null) scroll?.scrollToPage({ pageNumber: page });
  }, [scroll, documentId, currentPage]);

  return { jumpTo, followLink, goBack, goForward, canGoBack, canGoForward };
}

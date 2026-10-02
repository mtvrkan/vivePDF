import { useEffect, useRef } from "react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { rememberSplitPage, splitPageOf } from "@/shared/store/splitViewStore";

const POLL_MS = 200;
const POLL_LIMIT_MS = 8000;
const PAGE_COUNT_GRACE_MS = 2500;

export function useRestoredSplitPage(documentId: string, path: string) {
  const { provides: scroll, state } = useScroll(documentId);
  const settledRef = useRef(false);
  const totalRef = useRef(state.totalPages);
  totalRef.current = state.totalPages;
  const ready = state.totalPages > 0;

  useEffect(() => {
    if (!scroll || !ready || settledRef.current) return;
    const wanted = splitPageOf(path);
    if (wanted <= 1) {
      settledRef.current = true;
      return;
    }
    const showsPage = (page: number) => {
      try {
        const metrics = scroll.getMetrics();
        return metrics.currentPage === page || metrics.visiblePages.includes(page);
      } catch {
        return false;
      }
    };
    let waited = 0;
    const tick = () => {
      const known = totalRef.current;
      if (known < wanted && waited < PAGE_COUNT_GRACE_MS) return false;
      const target = Math.min(wanted, known);
      if (showsPage(target)) {
        settledRef.current = true;
        return true;
      }
      if (scroll.getLayout()?.virtualItems.some((item) => item.pageNumbers.includes(target))) scroll.scrollToPage({ pageNumber: target, behavior: "instant" });
      return false;
    };
    if (tick()) return;
    const poll = window.setInterval(() => {
      waited += POLL_MS;
      if (tick() || waited > POLL_LIMIT_MS) {
        settledRef.current = true;
        window.clearInterval(poll);
      }
    }, POLL_MS);
    return () => window.clearInterval(poll);
  }, [scroll, ready, path]);

  useEffect(() => {
    if (settledRef.current) rememberSplitPage(path, state.currentPage);
  }, [path, state.currentPage]);
}

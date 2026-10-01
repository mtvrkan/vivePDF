import { useEffect, useRef } from "react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useSearchRequestStore } from "@/shared/store/searchRequestStore";
import { useViewerJumpStore } from "@/shared/store/viewerJumpStore";

const POLL_MS = 200;
const POLL_LIMIT_MS = 8000;
const PAGE_COUNT_GRACE_MS = 2500;

export function PendingJump({ documentId }: { documentId: string }) {
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const { provides: scroll, state } = useScroll(documentId);
  const stateRef = useRef(state);
  stateRef.current = state;
  const totalPages = state.totalPages;

  useEffect(() => {
    if (!path || !scroll || totalPages === 0) return;
    let timers: number[] = [];
    const clearTimers = () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    };
    const layoutCovers = (target: number) => {
      const layout = scroll.getLayout();
      return !!layout && layout.virtualItems.some((item) => item.pageNumbers.includes(target));
    };
    const showsPage = (target: number) => {
      try {
        const metrics = scroll.getMetrics();
        return metrics.currentPage === target || metrics.visiblePages.includes(target);
      } catch {
        return false;
      }
    };
    const scrollUntilVisible = (page: number) => {
      const target = Math.min(Math.max(page, 1), stateRef.current.totalPages);
      let waited = 0;
      const tick = () => {
        if (showsPage(target)) return true;
        if (layoutCovers(target)) scroll.scrollToPage({ pageNumber: target });
        return false;
      };
      if (tick()) return;
      const poll = window.setInterval(() => {
        waited += POLL_MS;
        if (tick() || waited > POLL_LIMIT_MS) window.clearInterval(poll);
      }, POLL_MS);
      timers.push(poll);
    };
    const consumeAndScroll = () => {
      const consumed = useViewerJumpStore.getState().consume(path);
      if (consumed === null) return;
      scrollUntilVisible(consumed.page);
      if (consumed.query) useSearchRequestStore.getState().requestSearch(consumed.query);
    };
    const attempt = () => {
      const pending = useViewerJumpStore.getState().pending;
      if (!pending || pending.path !== path) return;
      clearTimers();
      if (pending.page > stateRef.current.totalPages) {
        timers.push(window.setTimeout(consumeAndScroll, PAGE_COUNT_GRACE_MS));
        return;
      }
      consumeAndScroll();
    };
    attempt();
    const unsubscribe = useViewerJumpStore.subscribe((store) => {
      if (store.pending && store.pending.path === path) attempt();
    });
    return () => {
      unsubscribe();
      clearTimers();
    };
  }, [path, scroll, totalPages]);

  return null;
}

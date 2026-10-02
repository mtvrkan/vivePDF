import { useEffect, useState, type RefObject } from "react";

export type PageRect = { pageIndex: number; left: number; top: number; width: number; height: number };

function rectsEqual(a: PageRect[], b: PageRect[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left.pageIndex !== right.pageIndex || left.left !== right.left || left.top !== right.top || left.width !== right.width || left.height !== right.height) return false;
  }
  return true;
}

export function usePageRects(containerRef: RefObject<HTMLElement | null>): PageRect[] {
  const [rects, setRects] = useState<PageRect[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;

    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const nodes = container.querySelectorAll<HTMLElement>("[data-page-index]");
      const next: PageRect[] = [];
      nodes.forEach((node) => {
        const indexAttr = node.getAttribute("data-page-index");
        if (indexAttr === null) return;
        const rect = node.getBoundingClientRect();
        next.push({
          pageIndex: Number(indexAttr),
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height,
        });
      });
      setRects((current) => (rectsEqual(current, next) ? current : next));
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    measure();
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(container);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(container, { childList: true, subtree: true });
    const scroller = container.querySelector<HTMLElement>("[data-pan-scroller]") ?? container;
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [containerRef]);

  return rects;
}

export function pageRectAt(rects: PageRect[], x: number, y: number): PageRect | null {
  return rects.find((rect) => x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) ?? null;
}

export function nearestPageRect(rects: PageRect[], x: number, y: number): PageRect | null {
  let best: PageRect | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const rect of rects) {
    const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
    const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = rect;
      bestDistance = distance;
    }
  }
  return best;
}

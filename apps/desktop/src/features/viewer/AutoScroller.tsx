import { useEffect, type RefObject } from "react";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { AUTO_SCROLL_SPEEDS, useAutoScrollStore } from "@/shared/store/autoScrollStore";
import { scrollDirectionOf, usePageDisplayStore } from "@/shared/store/pageDisplayStore";
import { isAutoScrollToggle, reachedEnd, scrollDistance, splitWhole, type ScrollAxis } from "./autoScroll";
import { hasOpenModal } from "./viewerKeyTarget";

const SPEED_UP_KEYS = new Set(["ArrowDown", "ArrowRight"]);
const SPEED_DOWN_KEYS = new Set(["ArrowUp", "ArrowLeft"]);

function axisOf(scroller: HTMLElement, horizontal: boolean): ScrollAxis {
  return horizontal
    ? { position: scroller.scrollLeft, size: scroller.scrollWidth, viewport: scroller.clientWidth }
    : { position: scroller.scrollTop, size: scroller.scrollHeight, viewport: scroller.clientHeight };
}

export function AutoScroller({ documentId, hostRef }: { documentId: string; hostRef: RefObject<HTMLElement | null> }) {
  const running = useAutoScrollStore((state) => state.running);

  useEffect(() => () => useAutoScrollStore.getState().stop(), [documentId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (hasOpenModal() || isTypingTarget(event.target)) return;
      const store = useAutoScrollStore.getState();
      if (isAutoScrollToggle(event)) {
        event.preventDefault();
        event.stopPropagation();
        store.toggle();
        return;
      }
      if (!store.running || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('[role="menu"]')) return;
      const handled = SPEED_UP_KEYS.has(event.key) || SPEED_DOWN_KEYS.has(event.key) || event.key === "-" || event.key === "Escape";
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      if (SPEED_UP_KEYS.has(event.key)) store.faster();
      else if (SPEED_DOWN_KEYS.has(event.key)) store.slower();
      else if (event.key === "-") store.reverse();
      else store.stop();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let previous: number | null = null;
    let carry = 0;
    const tick = (now: number) => {
      const store = useAutoScrollStore.getState();
      if (!store.running) return;
      const scroller = hostRef.current?.querySelector<HTMLElement>("[data-pan-scroller]");
      if (!scroller) {
        store.stop();
        return;
      }
      const horizontal = scrollDirectionOf(usePageDisplayStore.getState(), documentId) === "horizontal";
      if (previous !== null) {
        const { whole, rest } = splitWhole(scrollDistance(AUTO_SCROLL_SPEEDS[store.speedIndex], now - previous) + carry);
        carry = rest;
        if (reachedEnd(axisOf(scroller, horizontal), store.backwards)) {
          store.stop();
          return;
        }
        const step = store.backwards ? -whole : whole;
        if (step !== 0) {
          if (horizontal) scroller.scrollLeft += step;
          else scroller.scrollTop += step;
        }
      }
      previous = now;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [running, documentId, hostRef]);

  return null;
}

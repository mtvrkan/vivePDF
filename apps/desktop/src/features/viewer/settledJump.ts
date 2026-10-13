type JumpScroll = {
  scrollToPage: (options: { pageNumber: number; behavior: "instant" }) => void;
  getMetrics?: () => { currentPage: number; visiblePages: number[] };
};

export const SETTLE_MS = 1500;
export const CHECK_MS = 100;
const USER_EVENTS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

function showsPage(scroll: JumpScroll, target: number): boolean {
  try {
    const metrics = scroll.getMetrics?.();
    return !!metrics && (metrics.currentPage === target || metrics.visiblePages.includes(target));
  } catch {
    return false;
  }
}

export function jumpUntilSettled(scroll: JumpScroll, target: number): () => void {
  scroll.scrollToPage({ pageNumber: target, behavior: "instant" });
  let waited = 0;
  const stop = () => {
    window.clearInterval(poll);
    USER_EVENTS.forEach((name) => window.removeEventListener(name, stop, true));
  };
  const poll = window.setInterval(() => {
    waited += CHECK_MS;
    if (!showsPage(scroll, target)) scroll.scrollToPage({ pageNumber: target, behavior: "instant" });
    if (waited >= SETTLE_MS) stop();
  }, CHECK_MS);
  USER_EVENTS.forEach((name) => window.addEventListener(name, stop, true));
  return stop;
}

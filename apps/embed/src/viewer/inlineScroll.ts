import { useEffect } from "preact/hooks";

const SCROLLING = /(auto|scroll|overlay)/;

function scrollParent(element: Element): Element | null {
  let node: Node | null = element.parentNode;
  while (node) {
    if (node instanceof ShadowRoot) node = node.host;
    if (node instanceof Element && node !== document.body && node !== document.documentElement && SCROLLING.test(getComputedStyle(node).overflowY)) return node;
    node = node.parentNode;
  }
  return null;
}

export function useInlineScroll(host: HTMLElement | null, active: boolean): void {
  useEffect(() => {
    const frame = host?.parentElement;
    const viewport = host?.querySelector<HTMLElement>(".vp-viewport");
    const content = viewport?.firstElementChild;
    if (!active || !host || !frame || !viewport || !(content instanceof HTMLElement)) return;
    const scroller = scrollParent(frame);
    const scrollTarget: Element | Window = scroller ?? window;
    let synced = viewport.scrollTop;
    const follow = () => {
      viewport.scrollTop = host.getBoundingClientRect().top - frame.getBoundingClientRect().top;
      synced = viewport.scrollTop;
    };
    const lead = () => {
      const delta = viewport.scrollTop - synced;
      if (Math.abs(delta) < 1) return;
      synced = viewport.scrollTop;
      scrollTarget.scrollBy(0, delta);
    };
    const measure = () => {
      const style = getComputedStyle(viewport);
      frame.style.height = `${content.offsetHeight + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)}px`;
    };
    const sizes = new ResizeObserver(measure);
    sizes.observe(content);
    measure();
    follow();
    scrollTarget.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);
    viewport.addEventListener("scroll", lead, { passive: true });
    return () => {
      sizes.disconnect();
      scrollTarget.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
      viewport.removeEventListener("scroll", lead);
      frame.style.removeProperty("height");
    };
  }, [host, active]);
}

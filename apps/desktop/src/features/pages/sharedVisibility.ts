type VisibilityListener = (visible: boolean) => void;

const listeners = new Map<Element, VisibilityListener>();
let observer: IntersectionObserver | null = null;

function sharedObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: "200px" },
  );
  return observer;
}

export function observeVisibility(element: Element, listener: VisibilityListener): () => void {
  const shared = sharedObserver();
  listeners.set(element, listener);
  shared.observe(element);
  return () => {
    listeners.delete(element);
    shared.unobserve(element);
    if (listeners.size === 0) {
      shared.disconnect();
      observer = null;
    }
  };
}

import { useEffect, useState, type RefObject } from "react";

type Shared = { observer: IntersectionObserver; listeners: Map<Element, (visible: boolean) => void> };

const viewport = {};
const observers = new WeakMap<object, Shared>();

function observe(root: Element | null, margin: string, element: Element, listener: (visible: boolean) => void): () => void {
  const key = root ?? viewport;
  let shared = observers.get(key);
  if (!shared) {
    const listeners = new Map<Element, (visible: boolean) => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: margin },
    );
    shared = { observer, listeners };
    observers.set(key, shared);
  }
  const current = shared;
  current.listeners.set(element, listener);
  current.observer.observe(element);
  return () => {
    current.listeners.delete(element);
    current.observer.unobserve(element);
    if (current.listeners.size) return;
    current.observer.disconnect();
    observers.delete(key);
  };
}

export function useInView(ref: RefObject<Element | null>, root: RefObject<Element | null> | null, margin = "0px"): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    return observe(root?.current ?? null, margin, element, setVisible);
  }, [ref, root, margin]);
  return visible;
}

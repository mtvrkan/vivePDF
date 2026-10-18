import { useEffect, useRef, useState } from "react";

export function PageSkeleton() {
  const ref = useRef<HTMLDivElement>(null);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const observer = new MutationObserver(() => check());
    const check = () => {
      if (!host.querySelector("img, canvas")) return false;
      observer.disconnect();
      setPainted(true);
      return true;
    };
    if (check()) return;
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (painted) return null;
  return <div ref={ref} aria-hidden className="page-skeleton pointer-events-none absolute inset-0" />;
}

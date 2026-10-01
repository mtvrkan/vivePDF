import { useEffect, useRef, useState } from "react";

export function PageSkeleton() {
  const ref = useRef<HTMLDivElement>(null);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const check = () => {
      if (host.querySelector("img, canvas")) setPainted(true);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (painted) return null;
  return <div ref={ref} aria-hidden className="page-skeleton pointer-events-none absolute inset-0" />;
}

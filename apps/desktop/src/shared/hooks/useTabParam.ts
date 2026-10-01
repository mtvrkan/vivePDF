import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const requested = raw !== null && (tabs as readonly string[]).includes(raw) ? (raw as T) : null;
  const [tab, setTab] = useState<T>(requested ?? fallback);
  const applied = useRef<T | null>(requested);

  useEffect(() => {
    if (requested === null || applied.current === requested) return;
    applied.current = requested;
    setTab(requested);
  }, [requested]);

  const selectTab = useCallback(
    (next: T) => {
      applied.current = next;
      setTab(next);
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set("tab", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [tab, selectTab];
}

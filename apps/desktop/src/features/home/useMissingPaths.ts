import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useMissingPaths(paths: string[]): Set<string> {
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const key = paths.join("\n");

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (list.length === 0) return;
    let cancelled = false;
    invoke<boolean[]>("path_exists", { paths: list })
      .then((results) => {
        if (!cancelled) setMissing(new Set(list.filter((_, index) => !results[index])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return missing;
}

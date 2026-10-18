import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function usePathStamps(paths: string[]): Map<string, string> {
  const [stamps, setStamps] = useState<Map<string, string>>(new Map());
  const key = paths.join("\n");

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (list.length === 0) return;
    let cancelled = false;
    invoke<unknown[]>("path_stamps", { paths: list })
      .then((results) => {
        if (cancelled) return;
        const next = new Map<string, string>();
        list.forEach((path, index) => {
          const stamp = results[index];
          if (typeof stamp === "string") next.set(path, stamp);
        });
        setStamps(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return stamps;
}

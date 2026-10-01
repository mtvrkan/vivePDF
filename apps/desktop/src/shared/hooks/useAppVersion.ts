import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

const FALLBACK_VERSION = "0.1.0";
let cachedVersion: string | null = null;

export function useAppVersion(): string {
  const [version, setVersion] = useState(cachedVersion ?? FALLBACK_VERSION);

  useEffect(() => {
    if (cachedVersion) return;
    let cancelled = false;
    getVersion()
      .then((value) => {
        cachedVersion = value;
        if (!cancelled) setVersion(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return version;
}

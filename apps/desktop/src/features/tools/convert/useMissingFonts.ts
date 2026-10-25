import { useEffect, useRef, useState } from "react";
import { officeFonts } from "@/shared/rpc/operations";
import { extensionOf } from "@/shared/lib/paths";
import { OFFICE_LIKE_EXTENSIONS } from "./conversions";

export function useMissingFonts(files: string[], enabled: boolean): Record<string, string[]> {
  const [missing, setMissing] = useState<Record<string, string[]>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    for (const file of files) {
      if (!OFFICE_LIKE_EXTENSIONS.includes(extensionOf(file)) || requested.current.has(file)) continue;
      requested.current.add(file);
      officeFonts({ path: file })
        .then((result) => setMissing((state) => ({ ...state, [file]: result.missing })))
        .catch(() => requested.current.delete(file));
    }
  }, [files, enabled]);

  return missing;
}

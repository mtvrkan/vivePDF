import { useEffect, useState } from "react";
import { toRpcError } from "@/shared/rpc/client";
import { printPreview } from "@/shared/rpc/operations";
import type { PrintPaper, PrintPreviewParams, PrintPreviewResult, RpcError } from "@/types";

export const PREVIEW_WIDTH = 720;
export const PREVIEW_DEBOUNCE_MS = 250;

const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "CR", "PR"]);

export function previewPaper(locale: string): PrintPaper {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  return region && LETTER_REGIONS.has(region) ? "letter" : "a4";
}

export type PrintPreviewRequest = Omit<PrintPreviewParams, "sheet" | "width">;

export type PrintPreviewState = {
  status: "loading" | "ready" | "empty" | "error";
  result: PrintPreviewResult | null;
  error: RpcError | null;
  sheet: number;
  setSheet: (sheet: number) => void;
  retry: () => void;
};

type Loaded = { key: string; result: PrintPreviewResult | null; error: RpcError | null };

export function usePrintPreview(request: PrintPreviewRequest | null): PrintPreviewState {
  const key = request ? JSON.stringify(request) : null;
  const [position, setPosition] = useState({ key, sheet: 0 });
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const sheet = position.key === key ? position.sheet : 0;
  const requestKey = key === null ? null : `${key}#${sheet}#${attempt}`;

  useEffect(() => {
    if (key === null || requestKey === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params: PrintPreviewParams = { ...(JSON.parse(key) as PrintPreviewRequest), sheet, width: PREVIEW_WIDTH };
      printPreview(params, { signal: controller.signal })
        .then((result) => setLoaded({ key: requestKey, result, error: null }))
        .catch((caught: unknown) => {
          const error = toRpcError(caught);
          if (error.code !== "CANCELLED") setLoaded((previous) => ({ key: requestKey, result: previous?.result ?? null, error }));
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, requestKey, sheet]);

  const current = loaded?.key === requestKey;
  const emptyReason = loaded?.error?.data && (loaded.error.data as { reason?: unknown }).reason === "empty";
  const status = !current ? "loading" : loaded.error ? (emptyReason ? "empty" : "error") : "ready";

  return {
    status,
    result: loaded?.result ?? null,
    error: current ? loaded.error : null,
    sheet,
    setSheet: (next) => setPosition({ key, sheet: next }),
    retry: () => setAttempt((value) => value + 1),
  };
}

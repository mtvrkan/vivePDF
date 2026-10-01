import { useEffect, useState } from "react";
import { toRpcError, type RpcCallOptions } from "@/shared/rpc/client";
import type { RpcError } from "@/types";

const PREVIEW_DELAY_MS = 300;

export type EnginePreviewResult = { svg: string; width: number; height: number; missingGlyphs: string };
export type EnginePreviewState<R extends EnginePreviewResult> = { key: string; loading: boolean; result: R | null; error: RpcError | null };
type Fetcher<P, R> = (params: P, options?: RpcCallOptions) => Promise<R>;

export function useEnginePreview<P, R extends EnginePreviewResult>(fetcher: Fetcher<P, R>, key: string, enabled: boolean, attempt: number): EnginePreviewState<R> {
  const [state, setState] = useState<EnginePreviewState<R>>({ key: "", loading: false, result: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, loading: true, error: null }));
      fetcher(JSON.parse(key) as P, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) setState({ key, loading: false, result, error: null });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error: toRpcError(error) }));
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [fetcher, key, enabled, attempt]);

  return state;
}

export async function currentPreview<P, R extends EnginePreviewResult>(state: EnginePreviewState<R>, key: string, fetcher: Fetcher<P, R>): Promise<R> {
  return state.result && state.key === key ? state.result : fetcher(JSON.parse(key) as P);
}

import { useCallback, useEffect, useState } from "react";
import { toRpcError } from "@/shared/rpc/client";
import type { RpcError } from "@/types";
import { loadDraft, type StudioDraft } from "./draftStorage";

export type DraftState = { status: "loading" } | { status: "ready"; draft: StudioDraft | null } | { status: "error"; error: RpcError };

export function useStudioDraft(): { state: DraftState; retry: () => void } {
  const [state, setState] = useState<DraftState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadDraft()
      .then((draft) => {
        if (live) setState({ status: "ready", draft });
      })
      .catch((caught) => {
        if (live) setState({ status: "error", error: toRpcError(caught) });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }, []);

  return { state, retry };
}

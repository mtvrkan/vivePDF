import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toRpcError } from "@/shared/rpc/client";
import { studioPreviewDocument } from "@/shared/rpc/operations";
import type { RpcError } from "@/types";
import type { StudioDocumentPreview } from "@/types/studio";
import { documentText, laidOutContent } from "./content";
import { useDocumentStore } from "./documentStore";

const LAYOUT_DELAY_MS = 700;

export type LaidOut = StudioDocumentPreview & { blockIds: string[] };

export type DocumentLayout = { preview: LaidOut | null; error: RpcError | null; busy: boolean; refresh: () => Promise<void> };

export function useDocumentLayout(language: string): DocumentLayout {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<LaidOut | null>(null);
  const [error, setError] = useState<RpcError | null>(null);
  const [busy, setBusy] = useState(false);
  const ticket = useRef(0);

  const refresh = useCallback(async () => {
    const document = useDocumentStore.getState().document;
    if (!document || typeof document.content === "string") return;
    const mine = ++ticket.current;
    setBusy(true);
    try {
      const { content, blockIds } = await laidOutContent(document, language, documentText(t));
      const result = await studioPreviewDocument(content);
      if (mine !== ticket.current) return;
      setPreview({ ...result, blockIds });
      setError(null);
    } catch (caught) {
      if (mine === ticket.current) setError(toRpcError(caught));
    } finally {
      if (mine === ticket.current) setBusy(false);
    }
  }, [language, t]);

  useEffect(() => {
    let timer = setTimeout(() => void refresh(), LAYOUT_DELAY_MS);
    const unsubscribe = useDocumentStore.subscribe((state, previous) => {
      if (state.revision === previous.revision) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), LAYOUT_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh]);

  return { preview, error, busy, refresh };
}

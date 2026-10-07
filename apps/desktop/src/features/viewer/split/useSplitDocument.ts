import { useEffect, useState } from "react";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { documentRoomError } from "@/shared/lib/documentLimit";
import { isPdfPasswordError } from "@/shared/lib/pdfPassword";
import { toRpcError } from "@/shared/rpc/client";
import { fileNameOf } from "@/shared/rpc/files";
import { attachViewSource, closeViewable, openViewable, readOriginalSource } from "@/shared/session/viewSources";
import type { AsyncStatus, RpcError } from "@/types";

export type SplitDocumentState = { documentId: string | null; status: AsyncStatus; error: RpcError | null };

function splitOpenError(caught: unknown): RpcError {
  const error = toRpcError(caught);
  return isPdfPasswordError(caught) ? { ...error, code: "NEEDS_PASSWORD" } : error;
}

export function useSplitDocument(path: string, password: string | null, revision: number, attempt: number): SplitDocumentState {
  const { provides: docManager } = useDocumentManagerCapability();
  const [state, setState] = useState<SplitDocumentState>({ documentId: null, status: "loading", error: null });

  useEffect(() => {
    if (!docManager) return;
    const noRoom = documentRoomError(docManager.getDocumentCount());
    if (noRoom) {
      setState({ documentId: null, status: "error", error: noRoom });
      return;
    }
    const documentId = crypto.randomUUID();
    let cancelled = false;
    setState({ documentId: null, status: "loading", error: null });
    void (async () => {
      try {
        const source = await readOriginalSource(path);
        if (cancelled) {
          if (source.kind === "range") attachViewSource(documentId, source.token);
          closeViewable(docManager, documentId);
          return;
        }
        await openViewable(docManager, source, { name: fileNameOf(path), documentId, password: password ?? undefined, autoActivate: false });
        if (cancelled) {
          closeViewable(docManager, documentId);
          return;
        }
        setState({ documentId, status: "success", error: null });
      } catch (caught) {
        closeViewable(docManager, documentId);
        if (!cancelled) setState({ documentId: null, status: "error", error: splitOpenError(caught) });
      }
    })();
    return () => {
      cancelled = true;
      closeViewable(docManager, documentId);
    };
  }, [docManager, path, password, revision, attempt]);

  return state;
}

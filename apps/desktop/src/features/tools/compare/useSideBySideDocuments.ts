import { useEffect, useState } from "react";
import { PdfErrorCode, type PdfErrorReason } from "@embedpdf/models";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { documentRoomError } from "@/shared/lib/documentLimit";
import { toRpcError } from "@/shared/rpc/client";
import { fileNameOf } from "@/shared/rpc/files";
import { closeViewable, openViewable, readOriginalSource } from "@/shared/session/viewSources";
import type { AsyncStatus, RpcError, SourceDocument } from "@/types";

type DocumentManager = ReturnType<typeof useDocumentManagerCapability>["provides"];

type SideBySideState = {
  idA: string | null;
  idB: string | null;
  status: AsyncStatus;
  error: RpcError | null;
};

function isPasswordError(reason: unknown): boolean {
  return typeof reason === "object" && reason !== null && (reason as PdfErrorReason).code === PdfErrorCode.Password;
}

async function openSideBySideDocument(docManager: NonNullable<DocumentManager>, source: SourceDocument): Promise<string> {
  const documentId = crypto.randomUUID();
  const viewable = await readOriginalSource(source.path);
  try {
    await openViewable(docManager, viewable, { name: fileNameOf(source.path), documentId });
  } catch (error) {
    if (!isPasswordError(error) || !source.password) {
      closeViewable(docManager, documentId);
      throw error;
    }
    try {
      const response = await docManager.retryDocument(documentId, { password: source.password }).toPromise();
      await response.task.toPromise();
    } catch (retryError) {
      closeViewable(docManager, documentId);
      throw retryError;
    }
  }
  return documentId;
}

export function useSideBySideDocuments(sourceA: SourceDocument | null, sourceB: SourceDocument | null, enabled: boolean): SideBySideState {
  const { provides: docManager } = useDocumentManagerCapability();
  const [state, setState] = useState<SideBySideState>({ idA: null, idB: null, status: "idle", error: null });

  useEffect(() => {
    if (!enabled || !docManager || !sourceA || !sourceB || sourceA.path === sourceB.path) {
      setState({ idA: null, idB: null, status: "idle", error: null });
      return;
    }
    const noRoom = documentRoomError(docManager.getDocumentCount(), 2);
    if (noRoom) {
      setState({ idA: null, idB: null, status: "error", error: noRoom });
      return;
    }
    let cancelled = false;
    const opened: string[] = [];
    const closeOpened = () => {
      for (const documentId of opened.splice(0)) closeViewable(docManager, documentId);
    };
    const open = async (source: SourceDocument) => {
      const documentId = await openSideBySideDocument(docManager, source);
      opened.push(documentId);
      if (cancelled) closeOpened();
      return documentId;
    };
    setState({ idA: null, idB: null, status: "loading", error: null });
    void (async () => {
      try {
        const idA = await open(sourceA);
        if (cancelled) return;
        const idB = await open(sourceB);
        if (cancelled) return;
        setState({ idA, idB, status: "success", error: null });
      } catch (caught) {
        closeOpened();
        if (cancelled) return;
        setState({ idA: null, idB: null, status: "error", error: toRpcError(caught) });
      }
    })();
    return () => {
      cancelled = true;
      closeOpened();
    };
  }, [enabled, docManager, sourceA, sourceB]);

  return state;
}

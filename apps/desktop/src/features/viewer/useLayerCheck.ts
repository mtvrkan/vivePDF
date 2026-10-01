import { useEffect } from "react";
import * as logger from "@/shared/lib/logger";
import { listLayers } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useLayerViewStore } from "@/shared/store/layerViewStore";

const listedInfos = new WeakSet<object>();

const stillOpen = (documentId: string) => documentId in useDocumentStore.getState().documents;

export async function loadLayers(documentId: string, path: string, password: string | null) {
  useLayerViewStore.getState().setList(documentId, { state: "loading" });
  try {
    const { layers } = await listLayers({ path, password: password ?? undefined });
    if (stillOpen(documentId)) useLayerViewStore.getState().setList(documentId, { state: "listed", rows: layers });
  } catch (caught) {
    logger.warn("viewer.layers", caught instanceof Error ? caught.message : String(caught));
    if (stillOpen(documentId)) useLayerViewStore.getState().setList(documentId, { state: "failed" });
  }
}

export function useLayerCheck(documentId: string | null) {
  const document = useDocumentStore((state) => (documentId ? (state.documents[documentId] ?? null) : null));
  const info = document?.info ?? null;

  useEffect(() => {
    if (!document || !info || listedInfos.has(info)) return;
    listedInfos.add(info);
    void loadLayers(document.id, document.path, document.password);
  }, [document, info]);
}

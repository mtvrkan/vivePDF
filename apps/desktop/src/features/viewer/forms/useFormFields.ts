import { useEffect } from "react";
import { listFormFields } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import * as logger from "@/shared/lib/logger";
import { loadedFields, useFormFillStore, type FieldsLoad } from "./formFillStore";

const requested = new WeakSet<object>();

async function loadFields(documentId: string, path: string, password: string | null) {
  const store = useFormFillStore.getState();
  if (store.loads[documentId]?.state !== "loaded") store.setLoad(documentId, { state: "loading" });
  try {
    const result = await listFormFields({ path, password: password ?? undefined });
    useFormFillStore.getState().setLoad(documentId, loadedFields(result));
  } catch (caught) {
    logger.warn("viewer.formFill", caught instanceof Error ? caught.message : String(caught));
    useFormFillStore.getState().setLoad(documentId, { state: "failed" });
  }
}

export function useFormFields(documentId: string): FieldsLoad | null {
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const password = useDocumentStore((state) => state.documents[documentId]?.password ?? null);
  const info = useDocumentStore((state) => state.documents[documentId]?.info ?? null);
  const load = useFormFillStore((state) => state.loads[documentId] ?? null);

  useEffect(() => {
    if (!path || !info?.hasForms || requested.has(info)) return;
    requested.add(info);
    void loadFields(documentId, path, password);
  }, [documentId, path, password, info]);

  return info?.hasForms ? load : null;
}

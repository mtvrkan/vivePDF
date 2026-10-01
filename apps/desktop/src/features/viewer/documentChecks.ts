import { countSignatures, listFormFields, verifySignatures } from "@/shared/rpc/operations";
import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";
import * as logger from "@/shared/lib/logger";

type Source = { id: string; path: string; password: string | null };

function describeFailure(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export async function checkSignatures(source: Source) {
  const store = useDocumentMessagesStore.getState();
  store.setSignatures(source.id, { state: "loading" });
  try {
    const password = source.password ?? undefined;
    const { count } = await countSignatures({ path: source.path, password });
    if (count === 0) {
      store.setSignatures(source.id, { state: "none" });
      return;
    }
    const { signatures } = await verifySignatures({ path: source.path, password, online: false });
    store.setSignatures(source.id, signatures.length > 0 ? { state: "checked", signatures } : { state: "none" });
  } catch (caught) {
    logger.warn("viewer.signatures", describeFailure(caught));
    store.setSignatures(source.id, { state: "failed" });
  }
}

export async function toggleFieldHighlight(source: Source) {
  const store = useDocumentMessagesStore.getState();
  if (store.highlights[source.id]) {
    store.setHighlight(source.id, null);
    return;
  }
  store.setHighlight(source.id, { state: "loading" });
  try {
    const { boxes } = await listFormFields({ path: source.path, password: source.password ?? undefined });
    if (useDocumentMessagesStore.getState().highlights[source.id]) store.setHighlight(source.id, { state: "shown", boxes });
  } catch (caught) {
    logger.warn("viewer.formHighlight", describeFailure(caught));
    store.setHighlight(source.id, { state: "failed" });
  }
}

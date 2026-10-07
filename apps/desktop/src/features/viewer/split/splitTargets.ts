import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useSplitViewStore, type SplitLayout } from "@/shared/store/splitViewStore";
import type { OpenDocument } from "@/types";

export function otherOpenDocuments(primaryId: string): OpenDocument[] {
  const { documents, order } = useDocumentStore.getState();
  const ordered = order.flatMap((id) => (documents[id] ? [documents[id]] : []));
  const unordered = Object.values(documents).filter((entry) => !order.includes(entry.id));
  const primaryPath = documents[primaryId]?.path;
  return [...ordered, ...unordered].filter((entry) => entry.id !== primaryId && entry.path !== primaryPath);
}

export async function choosePdfPath(): Promise<string | null> {
  const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function compareWithAnotherDocument(primaryId: string, layout: SplitLayout = "columns"): Promise<void> {
  const primaryPath = useDocumentStore.getState().documents[primaryId]?.path;
  if (!primaryPath) return;
  const [other] = otherOpenDocuments(primaryId);
  if (other) {
    useSplitViewStore.getState().openWith(primaryPath, { path: other.path, password: other.password }, layout);
    return;
  }
  const chosen = await choosePdfPath();
  if (chosen) useSplitViewStore.getState().openWith(primaryPath, { path: chosen, password: null }, layout);
}

export function openBeside(activeId: string, otherId: string): void {
  const { documents } = useDocumentStore.getState();
  const active = documents[activeId];
  const other = documents[otherId];
  if (!active || !other || activeId === otherId) return;
  const store = useSplitViewStore.getState();
  store.openWith(active.path, { path: other.path, password: other.password }, store.lastLayout);
}

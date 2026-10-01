import { useActiveDocument } from "@embedpdf/plugin-document-manager/react";
import { useDocumentStore } from "@/shared/store/documentStore";

export function liveActiveDocumentId(activeId: string | null, status: string | null, registered: boolean): string | null {
  if (!activeId || status === null) return null;
  return registered || status !== "loaded" ? activeId : null;
}

export function useLiveActiveDocument() {
  const { activeDocumentId, activeDocument } = useActiveDocument();
  const registered = useDocumentStore((state) => (activeDocumentId ? Boolean(state.documents[activeDocumentId]) : false));
  const liveId = liveActiveDocumentId(activeDocumentId, activeDocument?.status ?? null, registered);
  return { activeDocumentId: liveId, activeDocument: liveId ? activeDocument : null };
}

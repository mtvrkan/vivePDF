import { useRef } from "react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useViewerJumpStore } from "@/shared/store/viewerJumpStore";
import { pathKey } from "@/shared/lib/paths";
import { restoreTabPlace, tabPlaceOf } from "./tabPlace";
import { useOpenPdf } from "./useOpenPdf";

export function useReloadDocument(documentId: string) {
  const { openPath, closeDocument } = useOpenPdf();
  const { state: scrollState } = useScroll(documentId);
  const pageRef = useRef(scrollState.currentPage);
  pageRef.current = scrollState.currentPage;

  return async () => {
    const path = useDocumentStore.getState().documents[documentId]?.path;
    if (!path) return false;
    const page = pageRef.current;
    const place = tabPlaceOf(documentId);
    closeDocument(documentId);
    const opened = await openPath(path);
    if (!opened) return false;
    const reopened = Object.values(useDocumentStore.getState().documents).find((document) => pathKey(document.path) === pathKey(path));
    if (reopened) restoreTabPlace(reopened.id, place);
    if (page > 1) useViewerJumpStore.getState().request({ path, page });
    return true;
  };
}

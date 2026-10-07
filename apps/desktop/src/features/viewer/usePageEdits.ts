import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { useToastStore } from "@/shared/store/toastStore";
import { canDeletePage, NO_PAGE_EDITS, pendingPageEdits, rotatePage, storePageEdits, toggleDeleted, type PageEdits } from "./pageEdits";

export function usePageEdits(documentId: string) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const { state: scrollState } = useScroll(documentId);
  const pending = usePendingChangesStore((state) => pendingPageEdits(pendingChangesFor(state.changes, documentId)));
  const edits: PageEdits = pending ?? NO_PAGE_EDITS;
  const pageCount = scrollState.totalPages;
  const label = t("viewer.pageEdits.label");

  const current = (): PageEdits => pendingPageEdits(pendingChangesFor(usePendingChangesStore.getState().changes, documentId)) ?? NO_PAGE_EDITS;

  const toggleDelete = (pageIndex: number) => {
    const next = toggleDeleted(current(), pageIndex, pageCount);
    if (!next) {
      toast("info", t("viewer.pageEdits.keepOnePage"));
      return;
    }
    storePageEdits(documentId, next, label);
  };

  const rotate = (pageIndex: number, delta: 90 | -90) => storePageEdits(documentId, rotatePage(current(), pageIndex, delta), label);

  const canDelete = (pageIndex: number) => canDeletePage(edits, pageIndex, pageCount);

  return { edits, toggleDelete, rotate, canDelete };
}

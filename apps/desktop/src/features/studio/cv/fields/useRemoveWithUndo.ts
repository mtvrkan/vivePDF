import { useTranslation } from "react-i18next";
import { useToastStore } from "@/shared/store/toastStore";
import { removeItem, restoreItem, type ListKey } from "../cvEdits";

export function useRemoveWithUndo(listKey: ListKey) {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);
  return (id: string, name: string) => {
    const removed = removeItem(listKey, id);
    if (removed) push("info", t("studio.cv.removed", { name }), { label: t("common.undo"), onClick: () => restoreItem(listKey, removed.item, removed.index) });
  };
}

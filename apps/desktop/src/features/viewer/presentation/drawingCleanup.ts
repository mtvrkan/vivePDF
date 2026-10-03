import i18n from "@/app/i18n";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useToastStore } from "@/shared/store/toastStore";

export const CLEAR_PAGE_SHORTCUT = "Shift+E";

export function clearWithUndo(clear: () => void) {
  const { strokesByPage, boardStrokes } = usePresentationStore.getState();
  clear();
  useToastStore.getState().push("info", i18n.t("presentation.cleanup.cleared"), {
    label: i18n.t("common.undo"),
    onClick: () => usePresentationStore.getState().restoreDrawings({ strokesByPage, boardStrokes }),
  });
}

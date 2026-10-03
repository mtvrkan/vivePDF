import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { describeError } from "@/shared/lib/errorMessage";
import { basenameOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { saveDesign } from "./projectFile";

const useSavingStore = create<{ saving: boolean }>(() => ({ saving: false }));

export function useDesignSave() {
  const { t } = useTranslation();
  const saving = useSavingStore((state) => state.saving);
  const save = useCallback(
    async (saveAs = false): Promise<boolean> => {
      if (useSavingStore.getState().saving) return false;
      useSavingStore.setState({ saving: true });
      try {
        const saved = await saveDesign({ saveAs, fallbackName: t("studio.untitled"), filterName: t("studio.project.filter") });
        if (saved) useToastStore.getState().push("success", t("studio.project.saved", { name: basenameOf(saved) }));
        return saved !== null;
      } catch (error) {
        useToastStore.getState().push("error", describeError(t, toRpcError(error)));
        return false;
      } finally {
        useSavingStore.setState({ saving: false });
      }
    },
    [t],
  );
  return { saving, save };
}

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { basenameOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { saveStudioDocument } from "./documentFile";

export function useDocumentSave() {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const save = useCallback(
    async (saveAs = false): Promise<boolean> => {
      setSaving(true);
      try {
        const saved = await saveStudioDocument({ saveAs, fallbackName: t("studio.doc.untitled"), filterName: t("studio.doc.filter") });
        if (saved) useToastStore.getState().push("success", t("studio.project.saved", { name: basenameOf(saved) }));
        return saved !== null;
      } catch (error) {
        useToastStore.getState().push("error", describeError(t, toRpcError(error)));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [t],
  );
  return { saving, save };
}

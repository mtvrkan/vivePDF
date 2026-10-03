import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { loadDesign } from "./projectFile";
import { useRecentDesignsStore } from "./recentDesigns";
import { useStudioStore } from "./studioStore";

export function useOpenDesign() {
  const { t } = useTranslation();
  const [opening, setOpening] = useState<string | null>(null);
  const openDesign = useCallback(
    async (path: string, password: string | null = null): Promise<boolean> => {
      setOpening(path);
      try {
        const loaded = await loadDesign(path, password);
        useStudioStore.getState().open(loaded.design, loaded.filePath);
        return true;
      } catch (error) {
        const rpcError = toRpcError(error);
        if (rpcError.code === "FILE_NOT_FOUND") {
          useRecentDesignsStore.getState().remove(path);
          useToastStore.getState().push("error", t("studio.project.missing"));
        } else {
          useToastStore.getState().push("error", describeError(t, rpcError));
        }
        return false;
      } finally {
        setOpening(null);
      }
    },
    [t],
  );
  return { opening, openDesign };
}

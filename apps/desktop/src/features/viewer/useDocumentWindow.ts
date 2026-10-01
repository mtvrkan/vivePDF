import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { openDocumentWindow } from "@/shared/rpc/files";
import { useToastStore } from "@/shared/store/toastStore";

export function useDocumentWindow() {
  const { t } = useTranslation();
  return useCallback(
    async (paths: string[] = []): Promise<boolean> => {
      try {
        await openDocumentWindow(paths);
        return true;
      } catch (error) {
        useToastStore.getState().push("error", describeError(t, toRpcError(error)));
        return false;
      }
    },
    [t],
  );
}

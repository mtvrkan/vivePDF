import type { TFunction } from "i18next";
import { useToastStore } from "@/shared/store/toastStore";
import { RevealError, revealPath } from "./reveal";

export function toastSavedFile(t: TFunction, message: string, path: string): void {
  const toast = useToastStore.getState().push;
  toast("success", message, {
    label: t("tools.reveal"),
    onClick: () => {
      revealPath(path).catch((error: unknown) => toast("error", t(error instanceof RevealError ? error.reasonKey : "errors.revealFailed")));
    },
  });
}

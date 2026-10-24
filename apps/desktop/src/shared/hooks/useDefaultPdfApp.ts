import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { defaultPdfAppStatus, makeDefaultPdfApp } from "@/shared/rpc/files";
import { useToastStore } from "@/shared/store/toastStore";
import type { DefaultAppStatus } from "@/types";

export type DefaultPdfApp = {
  status: DefaultAppStatus | null;
  busy: boolean;
  makeDefault: () => Promise<void>;
};

export function useDefaultPdfApp(): DefaultPdfApp {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const [status, setStatus] = useState<DefaultAppStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await defaultPdfAppStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const makeDefault = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await makeDefaultPdfApp(t("app.name"), t("settings.system.associationType"));
      toast(outcome === "settings" ? "info" : "success", t(outcome === "settings" ? "defaultApp.chooseInSettings" : "defaultApp.done"));
      await refresh();
    } catch (error) {
      const rpcError = toRpcError(error);
      if (rpcError.code !== "CANCELLED") toast("error", describeError(t, rpcError));
    } finally {
      setBusy(false);
    }
  }, [refresh, t, toast]);

  return { status, busy, makeDefault };
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { hideToTray } from "@/shared/rpc/tray";
import { allowClose, cancelQuit, hidesOnClose, registerCloseGuard, setTrayActive, shouldConfirmClose, type CloseWarning } from "./closeGuardState";

export function CloseGuard() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<CloseWarning | null>(null);

  useEffect(() => {
    const unregister = registerCloseGuard();
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (hidesOnClose()) {
        event.preventDefault();
        if (await hideToTray()) return;
        setTrayActive(false);
        void getCurrentWindow().close();
        return;
      }
      const state = shouldConfirmClose();
      if (!state) return;
      event.preventDefault();
      setPending(state);
    });
    return () => {
      unregister();
      void unlisten.then((stop) => stop());
    };
  }, []);

  if (!pending) return null;

  const description = pending.operations > 0 ? t("closeGuard.running", { count: pending.operations }) : t("closeGuard.documents", { count: pending.documents });

  return (
    <Dialog
      open
      title={t("closeGuard.title")}
      onClose={() => {
        cancelQuit();
        setPending(null);
      }}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              cancelQuit();
              setPending(null);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setPending(null);
              allowClose();
              void getCurrentWindow().close();
            }}
          >
            {t("closeGuard.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{description}</p>
    </Dialog>
  );
}

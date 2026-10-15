import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { takeUpdateAnnouncement } from "@/shared/lib/lastSeenVersion";
import * as logger from "@/shared/lib/logger";
import { isMainWindow } from "@/shared/lib/windowRole";
import { WhatsNewContent } from "./WhatsNewContent";

export function WhatsNewDialog() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isMainWindow()) return;
    let cancelled = false;
    getVersion()
      .then((current) => {
        if (!cancelled && takeUpdateAnnouncement(current)) setVersion(current);
      })
      .catch((error: unknown) => logger.warn("whatsNew", `version unavailable: ${String(error)}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => setVersion(null);

  return (
    <Dialog
      open={version !== null}
      title={t("whatsNew.updatedTitle", { version: version ?? "" })}
      onClose={close}
      size="lg"
      footer={
        <Button variant="primary" onClick={close}>
          {t("whatsNew.done")}
        </Button>
      }
    >
      {version ? <WhatsNewContent version={version} onNavigate={close} /> : null}
    </Dialog>
  );
}

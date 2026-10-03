import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { useStudioLaunchStore, type StudioLaunch } from "@/shared/store/studioLaunchStore";
import { useDocumentStore } from "../document/documentStore";
import { useDocumentSave } from "../document/useDocumentSave";
import { useStudioStore } from "./studioStore";
import { useDesignSave } from "./useDesignSave";
import { useOpenDesign } from "./useOpenDesign";

export function DesignLauncher() {
  const { t } = useTranslation();
  const pending = useStudioLaunchStore((state) => state.pending);
  const designName = useStudioStore((state) => state.design?.name ?? "");
  const documentName = useDocumentStore((state) => (state.document ? state.document.name : null));
  const name = documentName ?? designName;
  const [waiting, setWaiting] = useState<StudioLaunch | null>(null);
  const { openDesign } = useOpenDesign();
  const designSave = useDesignSave();
  const documentSave = useDocumentSave();
  const { saving, save } = documentName !== null ? documentSave : designSave;

  useEffect(() => {
    if (!pending) return;
    const launch = useStudioLaunchStore.getState().take();
    if (!launch) return;
    const state = useStudioStore.getState();
    const documentState = useDocumentStore.getState();
    if ((state.design && state.dirty) || (documentState.document && documentState.dirty)) setWaiting(launch);
    else void openDesign(launch.path, launch.password);
  }, [pending, openDesign]);

  const proceed = (launch: StudioLaunch) => {
    setWaiting(null);
    void openDesign(launch.path, launch.password);
  };

  return (
    <Dialog
      open={waiting !== null}
      onClose={() => setWaiting(null)}
      title={t("studio.project.unsavedTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={() => setWaiting(null)}>
            {t("common.cancel")}
          </Button>
          <Button variant="ghost" onClick={() => waiting && proceed(waiting)}>
            {t("studio.project.discard")}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() => {
              const launch = waiting;
              if (launch) void save(false).then((saved) => saved && proceed(launch));
            }}
          >
            {t("studio.project.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t("studio.project.unsavedBody", { name: name || t("studio.untitled") })}</p>
    </Dialog>
  );
}

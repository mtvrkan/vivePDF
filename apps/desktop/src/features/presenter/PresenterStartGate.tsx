import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { useDocumentSave } from "@/features/viewer/useDocumentSave";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { startPresenter, usePresenterStore } from "./presenterSession";

export function PresenterStartGate({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const request = usePresenterStore((state) => (state.request?.documentId === documentId ? state.request : null));
  const { state: scrollState } = useScroll(documentId);
  const { save, unsavedCount } = useDocumentSave(documentId);
  const [pending, setPending] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef(scrollState);
  scrollRef.current = scrollState;
  const unsavedRef = useRef(unsavedCount);
  unsavedRef.current = unsavedCount;

  const begin = (startPage: number) => {
    startPresenter(documentId, startPage).catch((error: unknown) => useToastStore.getState().push("error", describeError(t, toRpcError(error))));
  };
  const beginRef = useRef(begin);
  beginRef.current = begin;

  useEffect(() => {
    if (!request) return;
    usePresenterStore.getState().clearRequest();
    const startPage = request.startPage ?? Math.max(1, scrollRef.current.currentPage);
    if (unsavedRef.current() > 0) setPending(startPage);
    else beginRef.current(startPage);
  }, [request]);

  const close = () => setPending(null);

  const saveAndPresent = async () => {
    if (pending === null) return;
    setSaving(true);
    try {
      if (!(await save())) return;
      const startPage = pending;
      setPending(null);
      begin(startPage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={pending !== null}
      title={t("presentation.presenter.unsavedTitle")}
      onClose={close}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              const startPage = pending;
              setPending(null);
              if (startPage !== null) begin(startPage);
            }}
          >
            {t("presentation.presenter.presentAnyway")}
          </Button>
          <Button size="sm" variant="primary" loading={saving} onClick={() => void saveAndPresent()}>
            {t("presentation.presenter.saveAndPresent")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t("presentation.presenter.unsavedBody")}</p>
    </Dialog>
  );
}

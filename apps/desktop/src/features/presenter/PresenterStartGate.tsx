import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { setImmersiveFullscreen } from "@/features/viewer/immersive";
import { useDocumentSave } from "@/features/viewer/useDocumentSave";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { countScreens, startPresenter, usePresenterStore } from "./presenterSession";
import { SingleScreenDialog } from "./SingleScreenDialog";

export function PresenterStartGate({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const request = usePresenterStore((state) => (state.request?.documentId === documentId ? state.request : null));
  const { state: scrollState } = useScroll(documentId);
  const { save, unsavedCount } = useDocumentSave(documentId);
  const [pending, setPending] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [single, setSingle] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [stillSingle, setStillSingle] = useState(false);
  const scrollRef = useRef(scrollState);
  scrollRef.current = scrollState;
  const unsavedRef = useRef(unsavedCount);
  unsavedRef.current = unsavedCount;

  const present = (startPage: number) => {
    startPresenter(documentId, startPage).catch((error: unknown) => useToastStore.getState().push("error", describeError(t, toRpcError(error))));
  };

  const begin = (startPage: number) => {
    void countScreens().then((screens) => {
      if (screens !== null && screens < 2) {
        setStillSingle(false);
        setSingle(startPage);
      } else present(startPage);
    });
  };

  const retrySingle = async () => {
    if (single === null) return;
    setChecking(true);
    try {
      const screens = await countScreens();
      if (screens !== null && screens < 2) {
        setStillSingle(true);
        return;
      }
      const startPage = single;
      setSingle(null);
      present(startPage);
    } finally {
      setChecking(false);
    }
  };

  const takeSingle = (): number | null => {
    const startPage = single;
    setSingle(null);
    return startPage;
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
    <>
      <SingleScreenDialog
        open={single !== null}
        checking={checking}
        stillSingle={stillSingle}
        onRetry={() => void retrySingle()}
        onPresentHere={() => {
          const startPage = takeSingle();
          if (startPage !== null) void setImmersiveFullscreen(true, startPage);
        }}
        onRehearse={() => {
          const startPage = takeSingle();
          if (startPage !== null) present(startPage);
        }}
        onClose={() => setSingle(null)}
      />
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
    </>
  );
}

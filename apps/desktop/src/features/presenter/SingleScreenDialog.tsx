import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { isMac, isWindows } from "@/shared/lib/platform";

function extendHintKey(): string {
  if (isWindows) return "presentation.presenter.singleHintWindows";
  if (isMac) return "presentation.presenter.singleHintMac";
  return "presentation.presenter.singleHintOther";
}

type SingleScreenDialogProps = {
  open: boolean;
  checking: boolean;
  stillSingle: boolean;
  onRetry: () => void;
  onPresentHere: () => void;
  onRehearse: () => void;
  onClose: () => void;
};

export function SingleScreenDialog({ open, checking, stillSingle, onRetry, onPresentHere, onRehearse, onClose }: SingleScreenDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      title={t("presentation.presenter.singleTitle")}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onRehearse}>
            {t("presentation.presenter.singleRehearse")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onPresentHere}>
            {t("presentation.presenter.singlePresentHere")}
          </Button>
          <Button size="sm" variant="primary" loading={checking} onClick={onRetry}>
            {t("presentation.presenter.singleRetry")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>{t("presentation.presenter.singleBody")}</p>
        <p className="font-medium text-foreground">{t(extendHintKey())}</p>
        <p role="status" aria-live="polite" className={stillSingle ? "text-destructive" : "sr-only"}>
          {stillSingle ? t("presentation.presenter.singleStill") : ""}
        </p>
      </div>
    </Dialog>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { useOpenStore } from "@/shared/store/openStore";
import { useOpenPdf } from "./useOpenPdf";

export function PasswordDialog() {
  const { t } = useTranslation();
  const request = useOpenStore((state) => state.passwordRequest);
  const busy = useOpenStore((state) => state.busy);
  const { submitPassword, cancelPassword, resumeWaiting } = useOpenPdf();
  const [password, setPassword] = useState("");
  const waiting = useOpenStore((state) => state.waitingPaths.length > 0);

  useEffect(() => {
    if (!request && waiting && !busy) resumeWaiting();
  }, [request, waiting, busy, resumeWaiting]);

  if (!request) return null;

  const close = () => {
    setPassword("");
    cancelPassword(request.documentId);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    void submitPassword(request.documentId, password).then(() => setPassword(""));
  };

  return (
    <Dialog open title={t("password.title")} onClose={close}>
      <form id="password-form" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("password.description", { name: request.fileName })}</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-label={t("password.label")}
          aria-invalid={request.wrongPassword || undefined}
          placeholder={t("password.label")}
          autoComplete="off"
          className="field h-row w-full rounded-md px-3 text-base"
        />
        {request.wrongPassword ? (
          <p role="alert" className="text-sm text-destructive">
            {t("password.wrong")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!password}>
            {t("password.open")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

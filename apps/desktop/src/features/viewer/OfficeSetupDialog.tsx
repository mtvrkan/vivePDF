import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { OfflineNotice } from "@/components/shared/OfflineNotice";
import { describeError } from "@/shared/lib/errorMessage";
import { useOffline } from "@/shared/lib/offline";
import { toRpcError } from "@/shared/rpc/client";
import { fileNameOf } from "@/shared/rpc/files";
import { officeInstall, officeStatus, type OfficeStatusResult } from "@/shared/rpc/office";
import { useBundledOfficeStore } from "@/shared/session/bundledOffice";
import { useLaunchStore } from "@/shared/store/launchStore";
import { useOpenStore } from "@/shared/store/openStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import type { RpcProgress } from "@/types";
import { useOpenPdf } from "./useOpenPdf";

const CONVERT_ROUTE = "/tools/convert?mode=file-to-pdf";

export function OfficeSetupDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const path = useOpenStore((state) => state.officeRequest);
  const requestOffice = useOpenStore((state) => state.requestOffice);
  const { openPaths, resumeWaiting } = useOpenPdf();
  const offline = useOffline();
  const preparing = useBundledOfficeStore((state) => state.running);
  const refreshTools = useToolsStatusStore((state) => state.refresh);
  const [status, setStatus] = useState<OfficeStatusResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setError(null);
    officeStatus()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch((caught: unknown) => {
        if (live) setError(describeError(t, toRpcError(caught)));
      });
    return () => {
      live = false;
    };
  }, [path, preparing, t]);

  if (!path) return null;

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestOffice(null);
  };

  const close = () => {
    stop();
    resumeWaiting();
  };

  const openConverted = () => {
    requestOffice(null);
    void openPaths([path]).then(resumeWaiting);
  };

  const openConvertTool = () => {
    stop();
    useOpenStore.getState().takeWaiting();
    useLaunchStore.getState().setPending(path, CONVERT_ROUTE);
    void navigate(CONVERT_ROUTE);
  };

  const install = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setInstalling(true);
    setProgress(null);
    setError(null);
    try {
      const next = await officeInstall({ onProgress: setProgress, signal: controller.signal });
      setStatus(next);
      void refreshTools();
      if (!controller.signal.aborted && useOpenStore.getState().officeRequest === path) openConverted();
    } catch (caught) {
      if (!controller.signal.aborted) setError(describeError(t, toRpcError(caught)));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setInstalling(false);
      setProgress(null);
    }
  };

  const received = progress?.detail?.received;
  const total = progress?.detail?.total;
  const percent = typeof received === "number" && typeof total === "number" && total > 0 ? Math.round((received / total) * 100) : null;
  const bundled = status?.bundled === true;
  const busy = installing || preparing;
  const unsupported = status?.supported === false;
  const ready = status?.installed === true && !busy;
  const busyLabel = bundled || preparing ? t("progress.installing") : `${t("progress.downloading")}${percent !== null ? ` ${percent}%` : ""}`;

  return (
    <Dialog
      open
      title={t("viewer.converted.officeTitle")}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={openConvertTool}>
            {t("viewer.converted.openTool")}
          </Button>
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          {ready ? (
            <Button variant="primary" onClick={openConverted}>
              {t("common.retry")}
            </Button>
          ) : unsupported ? null : (
            <Button
              variant="primary"
              icon={<ArrowDownToLine className="size-4" aria-hidden />}
              loading={busy}
              disabled={busy || !status || (offline && !bundled)}
              onClick={() => void install()}
            >
              {busy ? busyLabel : bundled ? t("settings.office.installBundled") : t("settings.office.install")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("viewer.converted.officeNeeded", { name: fileNameOf(path) })}</p>
        {bundled ? null : <OfflineNotice />}
        {unsupported ? (
          <p className="text-sm text-muted-foreground">{t("settings.office.unsupported")}</p>
        ) : ready ? null : (
          <p className="text-xs text-muted-foreground">{bundled ? t("settings.office.bundledHint") : t("settings.office.downloadHint")}</p>
        )}
        {busy ? (
          <div className="h-1 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-label={busyLabel} aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent ?? 8}%` }} />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

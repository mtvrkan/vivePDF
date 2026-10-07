import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Images } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { OutputDirField } from "@/components/tool/OutputPathField";
import { Field, SelectInput } from "@/components/tool/form";
import { useOperation } from "@/shared/hooks/useOperation";
import { describeError } from "@/shared/lib/errorMessage";
import { stemOf } from "@/shared/lib/paths";
import { revealPath, RevealError } from "@/shared/lib/reveal";
import type { RpcCallOptions } from "@/shared/rpc/client";
import { convertToImages } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import type { ImageFormat, ImagesParams, ImagesResult } from "@/types";
import { discardExportCopy, type ExportSource } from "./organizerExport";

const DPI_CHOICES = [72, 96, 150, 200, 300, 400, 600];

type ExportImagesDialogProps = {
  open: boolean;
  count: number;
  documentPath: string;
  defaultDir: string;
  prepare: (options: RpcCallOptions) => Promise<ExportSource>;
  onClose: () => void;
};

export function ExportImagesDialog({ open, count, documentPath, defaultDir, prepare, onClose }: ExportImagesDialogProps) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(90);
  const [folder, setFolder] = useState(defaultDir);

  const runner = useCallback(
    async (params: ImagesParams, options: RpcCallOptions): Promise<ImagesResult> => {
      const source = await prepare(options);
      try {
        return await convertToImages({ ...params, path: source.path, password: source.password ?? undefined, pages: source.pages ?? undefined }, options);
      } finally {
        if (source.temporary) discardExportCopy(source.path);
      }
    },
    [prepare],
  );
  const operation = useOperation(runner);
  const { reset, cancel } = operation;
  const running = operation.status === "running";

  useEffect(() => {
    if (!open) return;
    setFolder(defaultDir);
    reset();
  }, [open, defaultDir, reset]);

  const save = () => {
    void operation.run({ path: documentPath, outputDir: folder, format, dpi, quality: format === "jpg" || format === "webp" ? quality : undefined, baseName: stemOf(documentPath) });
  };

  const close = () => {
    cancel();
    onClose();
  };

  const reveal = async (path: string) => {
    try {
      await revealPath(path);
    } catch (caught) {
      toast("error", t(caught instanceof RevealError ? caught.reasonKey : "errors.revealFailed"));
    }
  };

  const percent = Math.round((operation.progress?.progress ?? 0) * 100);
  const saved = operation.result?.outputs ?? [];

  return (
    <Dialog
      open={open}
      title={t("tools.pages.exportImages.title")}
      onClose={close}
      footer={
        <>
          {running ? (
            <Button size="sm" variant="secondary" onClick={cancel}>
              {t("common.cancel")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={close}>
              {t("common.close")}
            </Button>
          )}
          {operation.overwritePrompt ? (
            <Button size="sm" variant="primary" onClick={operation.confirmOverwrite}>
              {t("tools.pages.exportImages.replace")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<Images className="size-4" aria-hidden />} disabled={running || !folder} loading={running} onClick={save}>
              {t("tools.pages.exportImages.submit")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("tools.pages.exportImages.scope", { count })}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("tools.convert.imageFormat")}>
            <SelectInput value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)} disabled={running}>
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="webp">WebP</option>
              <option value="tiff">TIFF</option>
            </SelectInput>
          </Field>
          <Field label={t("tools.convert.dpi")}>
            <SelectInput value={dpi} onChange={(event) => setDpi(Number(event.target.value))} disabled={running}>
              {DPI_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectInput>
          </Field>
          {format === "jpg" || format === "webp" ? (
            <Field label={`${t("tools.convert.imageQuality")} · %${quality}`} hint={t("tools.convert.imageQualityHint")} className="col-span-2">
              <input type="range" disabled={running} min={10} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="w-full accent-primary" aria-label={t("tools.convert.imageQuality")} />
            </Field>
          ) : null}
        </div>
        <OutputDirField value={folder} onChange={setFolder} disabled={running} />
        {running ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{operation.progress?.message ? t(operation.progress.message, { defaultValue: t("tools.working"), ...operation.progress.detail }) : t("tools.working")}</p>
            <div className="h-1 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-label={t("tools.pages.exportImages.title")} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent}%` }} />
            </div>
          </div>
        ) : null}
        {operation.overwritePrompt ? (
          <p role="status" className="text-sm text-warning">
            {t("tools.pages.exportImages.exists")}
          </p>
        ) : null}
        {operation.error ? (
          <p role="alert" className="text-sm text-destructive">
            {describeError(t, operation.error)}
          </p>
        ) : null}
        {saved.length > 0 ? (
          <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
            <span>{t("tools.pages.exportImages.done", { count: saved.length })}</span>
            <Button size="sm" variant="ghost" icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void reveal(saved[0])}>
              {t("tools.reveal")}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

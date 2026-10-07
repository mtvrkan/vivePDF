import { useEffect, useState, type ReactNode } from "react";
import { FolderOpen, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { openFolder, openProducedFile } from "@/shared/rpc/files";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { nextStepsFor } from "@/shared/lib/nextSteps";
import { basenameOf } from "@/shared/lib/paths";
import { revealPath, sameDirectory, RevealError } from "@/shared/lib/reveal";
import { useLaunchStore } from "@/shared/store/launchStore";
import { useToastStore } from "@/shared/store/toastStore";
import { isPdfPath } from "@/shared/rpc/files";
import { renderThumbnail, thumbnailDataUrl } from "@/shared/rpc/thumbnail";
import type { OperationStatus, RpcError, RpcProgress } from "@/types";
import type { LucideIcon } from "lucide-react";
import { describeError } from "@/shared/lib/errorMessage";
import { OutputList } from "./OutputList";
import { RepairFileAction } from "./RepairFileAction";
import { SealedFileAction } from "./SealedFileAction";

type ResultPanelProps = {
  status: OperationStatus;
  progress: RpcProgress | null;
  error: RpcError | null;
  numeral?: string;
  caption?: string;
  outputs?: string[];
  idleIcon: LucideIcon;
  idleTitle: string;
  idleDescription: string;
  onCancel: () => void;
  onRetry?: () => void;
  overwritePrompt: { path: string } | null;
  overwriteWarning?: ReactNode;
  onConfirmOverwrite: () => void;
  onDismissOverwrite: () => void;
  children?: ReactNode;
  idleContent?: ReactNode;
  sourcePath?: string;
  sourcePassword?: string;
  outputPassword?: string;
};

function PreviewImage({ path, password, label }: { path: string; password?: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    void renderThumbnail({ path, password, width: 360 })
      .then((thumb) => {
        if (!cancelled) setUrl(thumbnailDataUrl(thumb));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path, password]);

  if (failed) return null;
  return (
    <figure className="min-w-0 flex-1">
      <div className="glass flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl p-1.5">
        {url ? <img src={url} alt={label} className="max-h-full max-w-full rounded-lg object-contain shadow-(--shadow-card)" /> : <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      <figcaption className="mt-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function NextSteps({ output }: { output: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const steps = nextStepsFor(location.pathname, output);
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
      <span className="me-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("tools.nextSteps")}</span>
      {steps.map((step) => {
        const Icon = step.icon;
        return (
          <button
            key={step.id}
            type="button"
            data-tone={step.tone ?? "improve"}
            onClick={() => {
              useLaunchStore.getState().setPending(output, step.route);
              void navigate(step.route);
            }}
            className="flex h-7 items-center gap-1.5 rounded-full border border-(--glass-border) bg-card/60 ps-2 pe-2.5 text-xs transition-colors duration-(--transition-fast) hover:border-(--tone)/50 hover:bg-(--tone-soft)"
          >
            <Icon className="size-3.5 text-(--tone)" aria-hidden />
            {t(step.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function ResultPreview({ sourcePath, sourcePassword, outputPath, outputPassword }: { sourcePath?: string; sourcePassword?: string; outputPath: string; outputPassword?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3 border-b px-4 py-3">
      {sourcePath && isPdfPath(sourcePath) ? <PreviewImage path={sourcePath} password={sourcePassword} label={t("tools.preview.before")} /> : null}
      <PreviewImage path={outputPath} password={outputPassword ?? sourcePassword} label={t("tools.preview.after")} />
    </div>
  );
}

export function ResultPanel({
  status,
  progress,
  error,
  numeral,
  caption,
  outputs = [],
  idleIcon,
  idleTitle,
  idleDescription,
  onCancel,
  onRetry,
  overwritePrompt,
  overwriteWarning,
  onConfirmOverwrite,
  onDismissOverwrite,
  children,
  idleContent,
  sourcePath,
  sourcePassword,
  outputPassword,
}: ResultPanelProps) {
  const { t } = useTranslation();
  const { openPath } = useOpenPdf();
  const toast = useToastStore((state) => state.push);
  const percent = Math.round((progress?.progress ?? 0) * 100);
  const commonDir = sameDirectory(outputs);

  const handleReveal = async (path: string) => {
    try {
      await revealPath(path);
    } catch (error) {
      const reasonKey = error instanceof RevealError ? error.reasonKey : "errors.revealFailed";
      toast("error", t(reasonKey));
    }
  };

  const handleOpenFolder = async (dir: string) => {
    try {
      await openFolder(dir);
    } catch {
      await handleReveal(dir);
    }
  };

  const handleOpen = async (output: string) => {
    if (isPdfPath(output)) {
      void openPath(output);
      return;
    }
    try {
      await openProducedFile(output);
    } catch {
      await handleReveal(output);
    }
  };

  return (
    <aside aria-label={t("tools.resultPanel")} aria-busy={status === "running" || undefined} className="glass-flat flex min-h-0 flex-col">
      <p role="status" className="sr-only">
        {status === "success" ? [numeral, caption].filter(Boolean).join(" ") || t("tools.done") : ""}
      </p>
      {status === "idle" ? (idleContent ?? <EmptyState icon={idleIcon} title={idleTitle} description={idleDescription} />) : null}
      {status === "running" ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
          <p aria-hidden className="font-mono text-display font-medium tabular-nums">{percent}%</p>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {progress?.message ? t(progress.message, { defaultValue: t("tools.working"), ...progress.detail }) : t("tools.working")}
          </p>
          <div className="h-1 w-full max-w-xs overflow-hidden rounded-sm bg-muted" role="progressbar" aria-label={t("tools.working")} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent}%` }} />
          </div>
          <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      ) : null}
      {status === "error" && error ? (
        <>
          <ErrorState title={t("tools.failed")} message={describeError(t, error)} onRetry={onRetry} />
          <SealedFileAction error={error} path={sourcePath} className="flex justify-center pb-6" />
          <RepairFileAction error={error} path={sourcePath} className="flex justify-center pb-6" />
        </>
      ) : null}
      {status === "success" ? (
        <div className="flex min-h-0 flex-col">
          <header className="border-b px-4 pb-3 pt-4">
            {numeral ? <p className="font-mono text-display font-medium tabular-nums">{numeral}</p> : null}
            {caption ? <p className="mt-1 text-sm text-muted-foreground">{caption}</p> : null}
          </header>
          {outputs[0] ? <NextSteps output={outputs[0]} /> : null}
          {outputs[0] && isPdfPath(outputs[0]) ? <ResultPreview sourcePath={sourcePath} sourcePassword={sourcePassword} outputPath={outputs[0]} outputPassword={outputPassword} /> : null}
          <OutputList outputs={outputs} onOpen={(output) => void handleOpen(output)} onReveal={(output) => void handleReveal(output)} />
          {commonDir && outputs.length >= 2 ? (
            <div className="border-b px-4 py-2.5">
              <Button size="sm" variant="ghost" icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void handleOpenFolder(commonDir)}>
                {t("tools.openOutputFolder")}
              </Button>
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
      <Dialog open={overwritePrompt !== null} title={t("tools.overwriteTitle")} onClose={onDismissOverwrite}
        footer={
          <>
            <Button variant="ghost" onClick={onDismissOverwrite}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={onConfirmOverwrite}>{t("tools.overwrite")}</Button>
          </>
        }
      >
        <p className="text-sm">{t("tools.overwriteDescription", { name: basenameOf(overwritePrompt?.path ?? "") })}</p>
        {overwriteWarning ? <div className="mt-3">{overwriteWarning}</div> : null}
      </Dialog>
    </aside>
  );
}

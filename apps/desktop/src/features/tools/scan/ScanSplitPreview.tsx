import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, Eye, Merge, RotateCcw, ScanText, Scissors, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { TextInput } from "@/components/tool/form";
import { LazyThumbnail } from "@/components/tool/PageGrid";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { previewScanSplit } from "@/shared/rpc/operations";
import { useLaunchStore } from "@/shared/store/launchStore";
import type { RpcError, RpcProgress, ScanSplitPart, ScanSplitPreviewResult, ScanSplitRules } from "@/types";
import { mergeWithPrevious, partPages, partsFromPreview, relabelPart, removePart, sameParts, splitPartAt } from "./splitParts";

type PreviewState = { status: "idle" } | { status: "loading" } | { status: "done"; result: ScanSplitPreviewResult } | { status: "error"; error: RpcError };

type ScanSplitPreviewProps = {
  rules: ScanSplitRules;
  ready: boolean;
  disabled?: boolean;
  parts?: ScanSplitPart[] | null;
  onPartsChange?: (parts: ScanSplitPart[] | null) => void;
};

export function ScanSplitPreview({ rules, ready, disabled, parts, onPartsChange }: ScanSplitPreviewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  const key = JSON.stringify(rules);

  useEffect(() => {
    setState({ status: "idle" });
    onPartsChange?.(null);
    return () => controller.current?.abort();
  }, [key, onPartsChange]);

  const run = () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: "loading" });
    setProgress(null);
    previewScanSplit(rules, { signal: current.signal, onProgress: setProgress })
      .then((result) => {
        if (current.signal.aborted) return;
        setState({ status: "done", result });
        onPartsChange?.(partsFromPreview(result.parts));
      })
      .catch((error: unknown) => {
        if (!current.signal.aborted) setState({ status: "error", error: toRpcError(error) });
      });
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setState({ status: "idle" });
    onPartsChange?.(null);
  };

  const percent = Math.round(Math.min(1, Math.max(0, progress?.progress ?? 0)) * 100);

  const openOcr = () => {
    useLaunchStore.getState().setPending(rules.path, "/tools/ocr");
    void navigate("/tools/ocr");
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button icon={<Eye className="size-4" aria-hidden />} loading={state.status === "loading"} disabled={!ready || disabled} onClick={run}>
          {t("tools.scan.split.preview.run")}
        </Button>
      </div>
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.status === "loading" ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="h-1 min-w-24 flex-1 overflow-hidden rounded-sm bg-muted" role="progressbar" aria-label={t("tools.working")} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {progress?.message ? t(progress.message, { defaultValue: t("tools.working"), ...progress.detail }) : t("tools.working")}
            </span>
            <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={cancel}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : null}
        {state.status === "loading" ? (
          <ul className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex items-center gap-3">
                <div className="h-12 w-9 animate-pulse rounded-md bg-muted" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {state.status === "error" ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
            <span>{describeError(t, state.error)}</span>
            <Button size="sm" onClick={run}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {state.status === "done" ? <PreviewResult rules={rules} result={state.result} parts={onPartsChange ? parts : undefined} disabled={disabled} onOcr={openOcr} onPartsChange={onPartsChange} /> : null}
      </div>
    </div>
  );
}

type PreviewResultProps = {
  rules: ScanSplitRules;
  result: ScanSplitPreviewResult;
  parts?: ScanSplitPart[] | null;
  disabled?: boolean;
  onOcr: () => void;
  onPartsChange?: (parts: ScanSplitPart[]) => void;
};

function PreviewResult({ rules, result, parts: editedParts, disabled, onOcr, onPartsChange }: PreviewResultProps) {
  const { t } = useTranslation();
  const [splitting, setSplitting] = useState<number | null>(null);
  const [splitPage, setSplitPage] = useState(0);
  const textless = rules.mode === "text" && result.pagesWithoutText > 0;
  const nothingFound = rules.mode === "text" ? result.parts.every((part) => part.label === null) : result.separatorPages.length === 0;
  const detected = partsFromPreview(result.parts);
  const parts = editedParts ?? detected;
  const edited = !sameParts(parts, detected);
  const change = (next: ScanSplitPart[]) => onPartsChange?.(next);

  const startSplit = (index: number) => {
    setSplitting(index);
    setSplitPage(parts[index].firstPage + 1);
  };

  const confirmSplit = (index: number) => {
    change(splitPartAt(parts, index, splitPage));
    setSplitting(null);
  };

  return (
    <>
      {textless ? (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">{t("tools.scan.split.preview.noText", { count: result.pagesWithoutText, total: result.pageCount })}</span>
          <Button size="sm" icon={<ScanText className="size-4" aria-hidden />} onClick={onOcr}>
            {t("tools.scan.split.preview.runOcr")}
          </Button>
        </div>
      ) : null}
      {parts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("tools.scan.split.preview.empty")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {[t("tools.scan.split.preview.summary", { count: parts.length }), nothingFound && !edited ? t("tools.scan.split.preview.nothingFound") : "", onPartsChange ? t("tools.scan.split.preview.usesList") : ""].filter(Boolean).join(" ")}
          </p>
          <ol className="flex max-h-96 flex-col gap-1.5 overflow-y-auto pe-1">
            {parts.map((part, index) => {
              const number = index + 1;
              return (
                <li key={part.firstPage} className="glass-chip flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                  <div className="w-9 shrink-0">
                    <LazyThumbnail path={rules.path} password={rules.password} page={part.firstPage} />
                  </div>
                  <span className="min-w-32 flex-1">
                    <span className="block font-medium">{t("tools.scan.split.preview.part", { n: number })}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("tools.scan.split.preview.range", { first: part.firstPage, last: part.lastPage })} · {t("tools.scan.split.preview.pages", { count: partPages(part) })}
                    </span>
                  </span>
                  {onPartsChange ? (
                    <>
                  <TextInput
                    value={part.label ?? ""}
                    onChange={(event) => change(relabelPart(parts, index, event.target.value))}
                    placeholder={t("tools.scan.split.preview.noLabel")}
                    aria-label={t("tools.scan.split.preview.labelFor", { n: number })}
                    maxLength={200}
                    disabled={disabled}
                    className="h-8 w-40 font-mono text-xs"
                  />
                  {splitting === index ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        confirmSplit(index);
                      }}
                    >
                      <TextInput
                        type="number"
                        min={part.firstPage + 1}
                        max={part.lastPage}
                        value={splitPage}
                        onChange={(event) => setSplitPage(Math.floor(Number(event.target.value)) || 0)}
                        aria-label={t("tools.scan.split.preview.splitFrom", { n: number })}
                        autoFocus
                        className="h-8 w-20 font-mono text-xs"
                      />
                      <Button size="sm" type="submit" disabled={splitPage <= part.firstPage || splitPage > part.lastPage}>
                        {t("tools.scan.split.preview.splitConfirm")}
                      </Button>
                      <IconButton icon={X} label={t("common.cancel")} onClick={() => setSplitting(null)} />
                    </form>
                  ) : (
                    <IconButton icon={Scissors} label={t("tools.scan.split.preview.splitPart", { n: number })} disabled={disabled || partPages(part) < 2} onClick={() => startSplit(index)} />
                  )}
                  <IconButton icon={Merge} label={t("tools.scan.split.preview.mergeUp", { n: number })} disabled={disabled || index === 0} onClick={() => change(mergeWithPrevious(parts, index))} />
                  <IconButton icon={Trash2} label={t("tools.scan.split.preview.removePart", { n: number })} disabled={disabled} onClick={() => change(removePart(parts, index))} />
                    </>
                  ) : part.label ? (
                    <span className="font-mono text-xs">{part.label}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      )}
      {edited && onPartsChange ? (
        <div>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => change(detected)} disabled={disabled}>
            {t("tools.scan.split.preview.reset")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

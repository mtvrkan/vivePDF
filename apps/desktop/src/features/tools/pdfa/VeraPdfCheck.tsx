import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { validatePdfa } from "@/shared/rpc/operations";
import type { PdfaLevel, PdfaValidateResult, RpcError } from "@/types";

type ValidationState = { status: "idle" } | { status: "running" } | { status: "done"; result: PdfaValidateResult } | { status: "error"; error: RpcError };

export function VeraPdfCheck({ path, level, label }: { path: string; level: PdfaLevel; label: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ValidationState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: "running" });
    try {
      const result = await validatePdfa({ path, level }, { signal: current.signal });
      if (!current.signal.aborted) setState({ status: "done", result });
    } catch (caught) {
      if (!current.signal.aborted) setState({ status: "error", error: toRpcError(caught) });
    }
  };

  const cancel = () => {
    controller.current?.abort();
    setState({ status: "idle" });
  };

  if (state.status === "running") {
    return (
      <div role="status" aria-label={t("tools.pdfa.vera.running")} className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>{t("tools.pdfa.vera.running")}</span>
          <Button size="sm" variant="ghost" onClick={cancel}>
            {t("common.cancel")}
          </Button>
        </div>
        {[0, 1].map((row) => (
          <div key={row} className="h-7 animate-pulse rounded-md bg-secondary/70" />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">
        <span>{describeError(t, state.error)}</span>
        <Button size="sm" variant="ghost" onClick={() => void run()}>
          {t("tools.pdfa.vera.again")}
        </Button>
      </div>
    );
  }

  if (state.status === "done") {
    const { result } = state;
    const Icon = result.compliant ? CheckCircle2 : XCircle;
    return (
      <div className="space-y-2 text-sm" aria-live="polite">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-start gap-2">
            <Icon className={result.compliant ? "mt-0.5 size-4 shrink-0 text-success" : "mt-0.5 size-4 shrink-0 text-destructive"} aria-hidden />
            <span>{result.compliant ? t("tools.pdfa.vera.compliant", { level: `PDF/A-${result.level}` }) : t("tools.pdfa.vera.failed", { count: result.failedRules, level: `PDF/A-${result.level}` })}</span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => void run()}>
            {t("tools.pdfa.vera.again")}
          </Button>
        </div>
        {result.rules.length > 0 ? (
          <ul className="max-h-64 overflow-auto rounded-lg border text-xs">
            {result.rules.map((rule) => (
              <li key={`${rule.clause}-${rule.testNumber}`} className="flex flex-col gap-0.5 border-b px-3 py-2 last:border-b-0">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-mono text-foreground">{t("tools.pdfa.vera.rule", { clause: rule.clause, test: rule.testNumber })}</span>
                  <span className="shrink-0 text-muted-foreground">{t("tools.pdfa.vera.occurrences", { count: rule.failedChecks })}</span>
                </span>
                <span lang="en" className="text-muted-foreground">
                  {rule.description}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {result.truncated ? <p className="text-xs text-muted-foreground">{t("tools.pdfa.vera.truncated", { count: result.rules.length })}</p> : null}
      </div>
    );
  }

  return (
    <Button size="sm" icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => void run()}>
      {label}
    </Button>
  );
}

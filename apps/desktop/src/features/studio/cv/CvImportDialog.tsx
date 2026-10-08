import { useEffect, useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { ErrorState } from "@/components/shared/ErrorState";
import { PasswordInput } from "@/components/shared/PasswordInput";
import { Checkbox, Field } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { basenameOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { studioCvImportPdf } from "@/shared/rpc/operations";
import type { RpcError, StudioCvImportResult } from "@/types";
import { applyImport, importCounts, isImportKey, type ImportKey, type ImportMode } from "./cvImport";
import { normalizeProfile, type CvProfile } from "./cvModel";

type Phase = { kind: "loading" } | { kind: "password"; wrong: boolean } | { kind: "error"; error: RpcError } | { kind: "review"; result: StudioCvImportResult; profile: CvProfile };

const PASSWORD_CODES = new Set(["NEEDS_PASSWORD", "ENCRYPTED"]);

type CvImportDialogProps = { path: string | null; onClose: () => void; onApply: (change: (current: CvProfile) => CvProfile) => void };

export function CvImportDialog({ path, onClose, onApply }: CvImportDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const passwordRef = useRef(password);
  passwordRef.current = password;
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<Set<ImportKey>>(new Set());

  useEffect(() => {
    if (!path) return;
    let live = true;
    setPhase({ kind: "loading" });
    const typed = passwordRef.current;
    studioCvImportPdf({ path, password: typed || null })
      .then((result) => {
        if (!live) return;
        const profile = normalizeProfile(result.profile);
        const counts = importCounts(profile);
        setChosen(new Set(result.sections.map((section) => section.key).filter(isImportKey).filter((key) => counts[key] > 0)));
        setPhase({ kind: "review", result, profile });
      })
      .catch((caught) => {
        if (!live) return;
        const error = toRpcError(caught);
        setPhase(PASSWORD_CODES.has(error.code) ? { kind: "password", wrong: Boolean(typed) } : { kind: "error", error });
      });
    return () => {
      live = false;
    };
  }, [path, attempt]);

  useEffect(() => {
    if (!path) {
      setPassword("");
      setChosen(new Set());
    }
  }, [path]);

  const apply = (mode: ImportMode) => {
    if (phase.kind !== "review") return;
    const raw = phase.result.profile;
    onApply((current) => applyImport(current, raw, chosen, mode));
  };

  const errorMessage = (error: RpcError) => (error.data?.reason === "noText" ? t("studio.cv.import.noText") : describeError(t, error));
  const toggle = (key: ImportKey, on: boolean) => setChosen((previous) => {
    const next = new Set(previous);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  });

  const review = phase.kind === "review" ? phase : null;
  const counts = review ? importCounts(review.profile) : null;
  const sections = review ? review.result.sections.filter((section) => isImportKey(section.key) && (counts?.[section.key as ImportKey] ?? 0) > 0) : [];

  return (
    <Dialog
      open={path !== null}
      title={t("studio.cv.import.title")}
      onClose={onClose}
      size="md"
      footer={
        review ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!chosen.size} onClick={() => apply("add")}>
              {t("studio.cv.import.add")}
            </Button>
            <Button variant="primary" disabled={!chosen.size} onClick={() => apply("replace")}>
              {t("studio.cv.import.replace")}
            </Button>
          </>
        ) : phase.kind === "password" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!password} onClick={() => setAttempt((value) => value + 1)}>
              {t("studio.cv.import.unlock")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        )
      }
    >
      <div data-testid="cv-import-dialog" className="space-y-4">
        {path ? <p className="truncate text-sm text-muted-foreground">{basenameOf(path)}</p> : null}
        {phase.kind === "loading" ? (
          <div className="space-y-2" aria-busy="true" aria-label={t("studio.cv.import.reading")}>
            {[100, 80, 60, 90, 70].map((width) => (
              <div key={width} className="h-9 animate-pulse rounded-lg bg-muted" style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : null}
        {phase.kind === "password" ? (
          <Field label={t("studio.cv.import.password")} hint={phase.wrong ? t("studio.cv.import.wrongPassword") : undefined}>
            <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={phase.wrong || undefined} autoFocus />
          </Field>
        ) : null}
        {phase.kind === "error" ? <ErrorState title={t("studio.cv.import.failed")} message={errorMessage(phase.error)} onRetry={() => setAttempt((value) => value + 1)} /> : null}
        {review && counts ? (
          sections.length ? (
            <>
              <p className="text-sm">{review.result.source === "linkedin" ? t("studio.cv.import.foundLinkedin") : t("studio.cv.import.found")}</p>
              <ul className="space-y-1" aria-label={t("studio.cv.import.sections")}>
                {sections.map((section) => {
                  const key = section.key as ImportKey;
                  const unsure = section.confidence < 0.5;
                  return (
                    <li key={key} className="flex items-center gap-2 rounded-lg border border-border/60 px-3">
                      <div className="min-w-0 flex-1">
                        <Checkbox label={key === "personal" ? t("studio.cv.personal") : t(`studio.cv.sections.${key}`)} checked={chosen.has(key)} onChange={(on) => toggle(key, on)} value={String(counts[key])} />
                      </div>
                      {unsure ? <span className="shrink-0 text-xs text-warning">{t("studio.cv.import.unsure")}</span> : null}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">{t("studio.cv.import.reviewHint")}</p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <FileWarning className="size-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{t("studio.cv.import.nothing")}</p>
              <p className="text-xs text-muted-foreground">{t("studio.cv.import.nothingHint")}</p>
            </div>
          )
        ) : null}
      </div>
    </Dialog>
  );
}

import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { ErrorState } from "@/components/shared/ErrorState";
import { SelectInput, TextArea } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { shortcutLabel, commandKey } from "@/shared/lib/platform";
import { shapeDataUrl } from "../shapes/render";
import type { MermaidDrawing } from "./mermaidEngine";
import { cleanMermaid, MAX_MERMAID_CHARS, MERMAID_TEMPLATES, MERMAID_THEMES, mermaidTitle, type MermaidSettings, type MermaidTheme } from "./mermaidModel";
import type { MermaidSource } from "./mermaidObject";

type Engine = { drawMermaid: (code: string, theme: MermaidTheme) => Promise<MermaidDrawing> };
type EngineState = { status: "loading" } | { status: "ready"; engine: Engine } | { status: "failed" };
type Preview = { key: string; drawing: MermaidDrawing } | null;

const PREVIEW_DELAY_MS = 300;
const PREVIEW_SCALE = 1.2;

function loadEngine(): Promise<Engine> {
  return import("./mermaidEngine");
}

function previewKey(settings: MermaidSettings): string {
  return JSON.stringify({ code: cleanMermaid(settings.code), theme: settings.theme });
}

export function MermaidDialog({ initial, updating, onClose, onSubmit }: { initial: MermaidSettings; updating: boolean; onClose: () => void; onSubmit: (source: MermaidSource) => void }) {
  const { t } = useTranslation();
  const codeId = useId();
  const hintId = useId();
  const statusId = useId();
  const themeId = useId();
  const [engineState, setEngineState] = useState<EngineState>({ status: "loading" });
  const [settings, setSettings] = useState<MermaidSettings>(initial);
  const [preview, setPreview] = useState<Preview>(null);

  const update = (change: Partial<MermaidSettings>) => setSettings((current) => ({ ...current, ...change }));
  const key = previewKey(settings);
  const blank = !cleanMermaid(settings.code);

  useEffect(() => {
    if (engineState.status !== "loading") return;
    let cancelled = false;
    loadEngine().then(
      (engine) => {
        if (!cancelled) setEngineState({ status: "ready", engine });
      },
      () => {
        if (!cancelled) setEngineState({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [engineState.status]);

  const engine = engineState.status === "ready" ? engineState.engine : null;

  useEffect(() => {
    if (!engine || blank) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void engine.drawMermaid(settings.code, settings.theme).then((drawing) => {
        if (!cancelled) setPreview({ key, drawing });
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [engine, blank, key, settings]);

  const current = preview && preview.key === key ? preview.drawing : null;
  const drawn = current && "svg" in current ? current : null;
  const failure = current && "error" in current ? current : null;

  const submit = () => {
    if (!drawn) return;
    onSubmit({ settings: { ...settings, code: cleanMermaid(settings.code) }, svg: drawn.svg, width: drawn.width, height: drawn.height });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && commandKey(event)) {
      event.preventDefault();
      submit();
    }
  };

  const failureMessage = () => {
    if (!failure) return null;
    if (failure.error === "drawFailed") return t("viewer.mermaid.drawFailed");
    return failure.line === null ? t("viewer.mermaid.invalid") : t("viewer.mermaid.invalidAt", { line: failure.line });
  };

  const previewBody = () => {
    if (engineState.status === "failed") return <ErrorState title={t("viewer.mermaid.engineErrorTitle")} message={t("viewer.mermaid.engineErrorMessage")} onRetry={() => setEngineState({ status: "loading" })} />;
    if (blank) {
      return (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <Network className="size-7 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{t("viewer.mermaid.emptyTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("viewer.mermaid.emptyHint")}</p>
          <Button size="sm" variant="secondary" className="mt-1" onClick={() => update({ code: MERMAID_TEMPLATES[0].code })}>
            {t("viewer.mermaid.startFlowchart")}
          </Button>
        </div>
      );
    }
    if (drawn) {
      return <img src={shapeDataUrl(drawn.svg)} alt={t("viewer.mermaid.previewAlt", { title: mermaidTitle(settings.code) })} draggable={false} className="max-h-full max-w-full object-contain" style={{ width: drawn.width * PREVIEW_SCALE }} />;
    }
    if (failure) {
      return (
        <div className="flex max-w-full flex-col gap-2 text-center">
          <p className="text-sm text-destructive">{failureMessage()}</p>
          {failure.message ? <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-start font-mono text-xs whitespace-pre-wrap text-muted-foreground" dir="ltr">{failure.message}</pre> : null}
        </div>
      );
    }
    return (
      <div className="flex w-full flex-col items-center gap-2" aria-hidden>
        <div className="h-32 w-3/4 animate-pulse rounded-lg bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    );
  };

  return (
    <Dialog
      open
      size="xl"
      title={updating ? t("viewer.mermaid.editTitle") : t("viewer.mermaid.title")}
      onClose={onClose}
      footer={
        <>
          <span className="me-auto text-xs text-muted-foreground">{shortcutLabel(t("viewer.mermaid.shortcutHint"))}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!drawn}>
            {updating ? t("viewer.mermaid.update") : t("viewer.mermaid.insert")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={codeId} className="text-sm font-medium text-foreground/80">
              {t("viewer.mermaid.codeLabel")}
            </label>
            <TextArea
              id={codeId}
              autoFocus
              rows={14}
              value={settings.code}
              maxLength={MAX_MERMAID_CHARS}
              onChange={(event) => update({ code: event.target.value })}
              onKeyDown={onKeyDown}
              dir="ltr"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              placeholder={MERMAID_TEMPLATES[0].code}
              aria-describedby={`${hintId} ${statusId}`}
              aria-invalid={failure ? true : undefined}
              className="resize-y font-mono text-sm leading-relaxed"
            />
            <p id={hintId} className="text-xs text-muted-foreground">
              {t("viewer.mermaid.codeHint")}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground/80">{t("viewer.mermaid.templates")}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MERMAID_TEMPLATES.map((template) => (
                <Button key={template.id} size="sm" variant="secondary" onClick={() => update({ code: template.code })}>
                  {t(`viewer.mermaid.kinds.${template.id}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor={themeId} className="text-sm font-medium text-foreground/80">
              {t("viewer.mermaid.theme")}
            </label>
            <SelectInput id={themeId} value={settings.theme} onChange={(event) => update({ theme: event.target.value as MermaidTheme })} className="w-44">
              {MERMAID_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {t(`viewer.mermaid.themes.${theme}`)}
                </option>
              ))}
            </SelectInput>
          </div>
        </div>
        <div
          id={statusId}
          role="status"
          aria-live="polite"
          aria-busy={!blank && !current && engineState.status !== "failed" ? true : undefined}
          className={cn("paper-surface flex min-h-72 items-center justify-center overflow-auto rounded-xl border bg-white p-4", failure && "border-destructive/60")}
        >
          {previewBody()}
        </div>
      </div>
    </Dialog>
  );
}

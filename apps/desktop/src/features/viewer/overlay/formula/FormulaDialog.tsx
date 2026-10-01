import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Sigma } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { ErrorState } from "@/components/shared/ErrorState";
import { Segmented, TextArea, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { clampFormulaSize, DEFAULT_FORMULA_COLOR, formulaDataUrl, MAX_FORMULA_SIZE, MIN_FORMULA_SIZE, type FormulaSource } from "./formulaSvg";
import { MatrixBuilder } from "./MatrixBuilder";
import { FORMULA_TEMPLATES, insertAt } from "./templates";
import type { TypesetResult } from "./mathjaxEngine";

export type FormulaDraft = { latex: string; color: string; size: number };
export type FormulaSubmit = { formula: FormulaSource; size: number };

type Engine = { typeset: (latex: string) => Promise<TypesetResult> };
type EngineState = { status: "loading" } | { status: "ready"; engine: Engine } | { status: "failed" };
type Preview = { status: "idle" } | { status: "rendering" } | { status: "ok"; latex: string; result: Extract<TypesetResult, { svg: string }> } | { status: "error"; latex: string; message: string };

const PREVIEW_DELAY_MS = 150;
const TEMPLATE_PX_PER_EM = 20;
const TEMPLATE_MAX_HEIGHT_PX = 36;
const TEMPLATE_MAX_WIDTH_PX = 160;

type TemplatePreview = { url: string; width: number; height: number } | null;
const templatePreviews = new Map<string, TemplatePreview>();

function templatePreviewOf(result: TypesetResult): TemplatePreview {
  if (!("svg" in result)) return null;
  const scale = Math.min(TEMPLATE_PX_PER_EM, TEMPLATE_MAX_HEIGHT_PX / result.emHeight, TEMPLATE_MAX_WIDTH_PX / result.emWidth);
  return { url: formulaDataUrl({ ...result, color: DEFAULT_FORMULA_COLOR }), width: result.emWidth * scale, height: result.emHeight * scale };
}

function loadEngine(): Promise<Engine> {
  return import("./mathjaxEngine");
}

function TemplateButton({ latex, engine, onPick }: { latex: string; engine: Engine | null; onPick: (latex: string) => void }) {
  const [preview, setPreview] = useState<TemplatePreview | undefined>(templatePreviews.get(latex));

  useEffect(() => {
    if (!engine || preview !== undefined) return;
    let cancelled = false;
    void engine.typeset(latex).then((result) => {
      const next = templatePreviewOf(result);
      templatePreviews.set(latex, next);
      if (!cancelled) setPreview(next);
    });
    return () => {
      cancelled = true;
    };
  }, [engine, latex, preview]);

  return (
    <button
      type="button"
      onClick={() => onPick(latex)}
      title={latex}
      aria-label={latex}
      className="flex h-12 min-w-12 items-center justify-center rounded-lg border bg-white px-2 transition-[box-shadow] duration-(--transition-fast) hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {preview ? <img src={preview.url} alt="" draggable={false} style={{ width: preview.width, height: preview.height }} /> : <span className="max-w-40 truncate font-mono text-[11px] text-muted-foreground">{latex}</span>}
    </button>
  );
}

export function FormulaDialog({ initial, updating, onClose, onSubmit }: { initial: FormulaDraft; updating: boolean; onClose: () => void; onSubmit: (value: FormulaSubmit) => void }) {
  const { t } = useTranslation();
  const latexId = useId();
  const statusId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [engineState, setEngineState] = useState<EngineState>({ status: "loading" });
  const [latex, setLatex] = useState(initial.latex);
  const [color, setColor] = useState(initial.color);
  const [size, setSize] = useState(String(initial.size));
  const [group, setGroup] = useState(FORMULA_TEMPLATES[0].id);
  const [preview, setPreview] = useState<Preview>({ status: "idle" });

  useEffect(() => {
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (engineState.status === "ready") return;
    let cancelled = false;
    setEngineState({ status: "loading" });
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
    if (!engine) return;
    const source = latex.trim();
    if (!source) {
      setPreview({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPreview((current) => (current.status === "ok" ? current : { status: "rendering" }));
    const timer = window.setTimeout(() => {
      void engine.typeset(source).then((result) => {
        if (cancelled) return;
        setPreview("svg" in result ? { status: "ok", latex: source, result } : { status: "error", latex: source, message: result.error });
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [engine, latex]);

  const numericSize = clampFormulaSize(Number(size));
  const current = preview.status === "ok" || preview.status === "error" ? (preview.latex === latex.trim() ? preview : null) : null;
  const ready = current?.status === "ok";

  const submit = () => {
    if (current?.status !== "ok") return;
    onSubmit({ formula: { latex: current.latex, svg: current.result.svg, color, emWidth: current.result.emWidth, emHeight: current.result.emHeight }, size: numericSize });
  };

  const pickTemplate = (template: string) => {
    const area = textareaRef.current;
    const start = area?.selectionStart ?? latex.length;
    const end = area?.selectionEnd ?? latex.length;
    const next = insertAt(latex, template, start, end);
    setLatex(next.text);
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  const activeGroup = FORMULA_TEMPLATES.find((entry) => entry.id === group) ?? FORMULA_TEMPLATES[0];

  const previewBody = () => {
    if (engineState.status === "failed") return <ErrorState title={t("viewer.formula.engineErrorTitle")} message={t("viewer.formula.engineErrorMessage")} onRetry={() => setEngineState({ status: "loading" })} />;
    if (!latex.trim()) {
      return (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <Sigma className="size-7 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{t("viewer.formula.emptyTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("viewer.formula.emptyHint")}</p>
        </div>
      );
    }
    if (preview.status === "ok") return <img src={formulaDataUrl({ ...preview.result, color })} alt={preview.latex} draggable={false} className="max-h-40 max-w-full object-contain" />;
    if (preview.status === "error") {
      return (
        <p className="text-center text-sm text-destructive">
          {t("viewer.formula.latexError")}
          <span className="mt-1 block font-mono text-xs">{preview.message}</span>
        </p>
      );
    }
    return (
      <div className="flex w-full flex-col items-center gap-2" aria-hidden>
        <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    );
  };

  return (
    <Dialog
      open
      size="xl"
      title={updating ? t("viewer.formula.editTitle") : t("viewer.formula.title")}
      onClose={onClose}
      footer={
        <>
          <span className="me-auto text-xs text-muted-foreground">{t("viewer.formula.shortcutHint")}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!ready}>
            {updating ? t("viewer.formula.update") : t("viewer.formula.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div id={statusId} role="status" aria-live="polite" aria-busy={latex.trim().length > 0 && !current} className={cn("paper-surface flex min-h-32 items-center justify-center rounded-xl border bg-white p-4", current?.status === "error" && "border-destructive/60")}>
          {previewBody()}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={latexId} className="text-sm font-medium text-foreground/80">
            {t("viewer.formula.latexLabel")}
          </label>
          <TextArea
            id={latexId}
            ref={textareaRef}
            value={latex}
            onChange={(event) => setLatex(event.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            dir="ltr"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={String.raw`\frac{a}{b}`}
            aria-describedby={statusId}
            aria-invalid={current?.status === "error"}
            className="font-mono"
          />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground/80">{t("viewer.formula.color")}</span>
            <ColorSwatch value={color} onChange={setColor} label={t("viewer.formula.color")} customLabel={t("viewer.overlay.customColor")} />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground/80">{t("viewer.formula.size")}</span>
            <span className="flex items-center gap-1.5">
              <TextInput type="number" min={MIN_FORMULA_SIZE} max={MAX_FORMULA_SIZE} value={size} onChange={(event) => setSize(event.target.value)} onBlur={() => setSize(String(numericSize))} className="h-9 w-20 font-mono" />
              <span className="text-xs text-muted-foreground">pt</span>
            </span>
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <Segmented size="sm" value={group} options={FORMULA_TEMPLATES.map((entry) => entry.id)} labelOf={(id) => t(FORMULA_TEMPLATES.find((entry) => entry.id === id)?.labelKey ?? "")} onChange={setGroup} ariaLabel={t("viewer.formula.templates")} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4" />
          {activeGroup.id === "matrices" ? <MatrixBuilder onInsert={pickTemplate} /> : null}
          <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto p-0.5">
            {activeGroup.items.map((item) => (
              <TemplateButton key={item} latex={item} engine={engine} onPick={pickTemplate} />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

import { useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { Field, SwitchField, TextInput } from "@/components/tool/form";
import { labelsOf, renderShape, shapeDataUrl } from "../shapes/render";
import { useLabelArt } from "../shapes/useLabelArt";
import type { ParseResult } from "./expression";
import type { GraphSource } from "./graphObject";
import { FUNCTION_COLORS, GRAPH_EXAMPLES, GRAPH_STYLE, LEGEND_NAMES, MAX_FUNCTIONS, planGraph, type GraphFunction, type GraphSettings } from "./plot";

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function NumberBox({ label, value, disabled, onCommit }: { label: string; value: number; disabled?: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<{ text: string; value: number } | null>(null);
  const shown = draft && draft.value === value ? draft.text : formatNumber(value);
  return (
    <Field label={label}>
      <TextInput
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        onChange={(event) => {
          const text = event.target.value;
          const parsed = Number(text.replace(",", "."));
          const valid = text.trim() !== "" && Number.isFinite(parsed);
          if (valid) onCommit(parsed);
          setDraft({ text, value: valid ? parsed : value });
        }}
        onBlur={() => setDraft(null)}
        className="font-mono"
      />
    </Field>
  );
}

function errorMessage(result: ParseResult, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  if ("expression" in result || result.error === "empty") return null;
  if (result.error === "unexpected" && !result.detail) return t("viewer.graph.errors.incomplete");
  return t(`viewer.graph.errors.${result.error}`, { detail: result.detail });
}

function FunctionRow({ index, item, result, removable, onChange, onRemove, onFocus }: { index: number; item: GraphFunction; result: ParseResult; removable: boolean; onChange: (item: GraphFunction) => void; onRemove: () => void; onFocus: () => void }) {
  const { t } = useTranslation();
  const errorId = useId();
  const name = LEGEND_NAMES[index];
  const message = errorMessage(result, t);
  return (
    <div className="flex items-start gap-2">
      <span className="flex h-row w-14 shrink-0 items-center justify-end font-mono text-sm text-muted-foreground" aria-hidden>
        {name}(x) =
      </span>
      <div className="min-w-0 flex-1">
        <TextInput
          value={item.expression}
          onChange={(event) => onChange({ ...item, expression: event.target.value })}
          onFocus={onFocus}
          aria-label={t("viewer.graph.functionLabel", { name })}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errorId : undefined}
          placeholder={t("viewer.graph.placeholder")}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
        />
        {message ? (
          <p id={errorId} className="mt-1 text-xs text-destructive">
            {message}
          </p>
        ) : null}
      </div>
      <div className="flex h-row items-center">
        <ColorSwatch value={item.color} onChange={(color) => onChange({ ...item, color })} label={t("viewer.graph.color", { name })} customLabel={t("viewer.overlay.customColor")} />
      </div>
      {removable ? (
        <div className="flex h-row items-center">
          <IconButton icon={Trash2} label={t("viewer.graph.remove", { name })} onClick={onRemove} />
        </div>
      ) : null}
    </div>
  );
}

export function GraphDialog({ initial, updating, onClose, onSubmit }: { initial: GraphSettings; updating: boolean; onClose: () => void; onSubmit: (source: GraphSource) => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<GraphSettings>(initial);
  const [focused, setFocused] = useState(0);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => planGraph(settings), [settings]);
  const latexList = useMemo(() => labelsOf(plan.primitives), [plan]);
  const labelArt = useLabelArt(latexList);
  const rendered = renderShape(plan.primitives, GRAPH_STYLE, labelArt.labels);
  const valid = plan.parsed.some((result) => "expression" in result) && plan.parsed.every((result) => "expression" in result || result.error === "empty");

  const update = (change: Partial<GraphSettings>) => setSettings((current) => ({ ...current, ...change }));
  const setFunction = (index: number, item: GraphFunction) => update({ functions: settings.functions.map((entry, position) => (position === index ? item : entry)) });
  const removeFunction = (index: number) => {
    update({ functions: settings.functions.filter((_, position) => position !== index) });
    setFocused(0);
  };
  const addFunction = () => {
    const used = new Set(settings.functions.map((item) => item.color));
    const color = FUNCTION_COLORS.find((entry) => !used.has(entry)) ?? FUNCTION_COLORS[settings.functions.length % FUNCTION_COLORS.length];
    update({ functions: [...settings.functions, { expression: "", color }] });
    setFocused(settings.functions.length);
  };
  const pickExample = (expression: string) => {
    const index = Math.min(focused, settings.functions.length - 1);
    setFunction(index, { ...settings.functions[index], expression });
  };
  const setAutoY = (autoY: boolean) => update(autoY ? { autoY } : { autoY, yMin: Math.round(plan.y.min * 1000) / 1000, yMax: Math.round(plan.y.max * 1000) / 1000 });

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await labelArt.settle();
      const final = renderShape(plan.primitives, GRAPH_STYLE, labelArt.labels);
      onSubmit({ settings, svg: final.svg, width: final.width, height: final.height });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="xl"
      title={updating ? t("viewer.graph.editTitle") : t("viewer.graph.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={busy || !valid}>
            {updating ? t("viewer.graph.update") : t("viewer.graph.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-foreground/80">{t("viewer.graph.functions")}</legend>
          {settings.functions.map((item, index) => (
            <FunctionRow key={index} index={index} item={item} result={plan.parsed[index]} removable={settings.functions.length > 1} onChange={(next) => setFunction(index, next)} onRemove={() => removeFunction(index)} onFocus={() => setFocused(index)} />
          ))}
          <div className="flex flex-wrap items-center gap-2 pl-16">
            {settings.functions.length < MAX_FUNCTIONS ? (
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} onClick={addFunction}>
                {t("viewer.graph.addFunction")}
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">{t("viewer.graph.examples")}</span>
            {GRAPH_EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => pickExample(example)} className="rounded-md border px-2 py-0.5 font-mono text-xs transition-[box-shadow] duration-(--transition-fast) hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {example}
              </button>
            ))}
          </div>
          <p className="pl-16 text-xs text-muted-foreground">{t("viewer.graph.syntaxHint")}</p>
        </fieldset>
        <div className="grid gap-4 md:grid-cols-5">
          <div className="flex flex-col gap-1.5 md:col-span-3">
            <div role="img" aria-label={t("viewer.graph.previewLabel")} aria-busy={labelArt.status === "loading"} className="paper-surface flex h-72 items-center justify-center rounded-xl border bg-white p-4">
              <img src={shapeDataUrl(rendered.svg)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
            </div>
            {labelArt.status === "failed" ? <p className="text-xs text-destructive">{t("viewer.graph.labelsFailed")}</p> : null}
          </div>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto md:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <NumberBox label={t("viewer.graph.xMin")} value={settings.xMin} onCommit={(xMin) => update({ xMin })} />
              <NumberBox label={t("viewer.graph.xMax")} value={settings.xMax} onCommit={(xMax) => update({ xMax })} />
            </div>
            <SwitchField label={t("viewer.graph.autoY")} checked={settings.autoY} onChange={setAutoY} />
            <div className="grid grid-cols-2 gap-3">
              <NumberBox label={t("viewer.graph.yMin")} value={settings.autoY ? plan.y.min : settings.yMin} disabled={settings.autoY} onCommit={(yMin) => update({ yMin })} />
              <NumberBox label={t("viewer.graph.yMax")} value={settings.autoY ? plan.y.max : settings.yMax} disabled={settings.autoY} onCommit={(yMax) => update({ yMax })} />
            </div>
            <SwitchField label={t("viewer.graph.equalScale")} checked={settings.equalScale} onChange={(equalScale) => update({ equalScale })} />
            <SwitchField label={t("viewer.graph.grid")} checked={settings.grid} onChange={(grid) => update({ grid })} />
            <SwitchField label={t("viewer.graph.legend")} checked={settings.legend} onChange={(legend) => update({ legend })} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

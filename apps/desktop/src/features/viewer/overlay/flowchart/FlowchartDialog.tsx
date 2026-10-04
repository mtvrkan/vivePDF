import { useMemo, useState } from "react";
import { ArrowRight, Plus, Trash2, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch, type ColorSwatchRow } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, Segmented, SliderField, SwitchField, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { flowchartPreview } from "@/shared/rpc/operations";
import type { FlowShape, RpcError } from "@/types";
import { EnginePreview } from "../grid/EnginePreview";
import { currentPreview, useEnginePreview } from "../grid/useEnginePreview";
import type { FlowchartSource } from "./flowchartObject";
import { FLOW_DIRECTIONS, FLOW_LIMITS, FLOW_SHAPES, addArrow, addStep, isBlankFlowchart, removeArrow, removeStep, toFlowchartSpec, updateArrow, updateStep, type FlowchartSettings } from "./flowchartModel";

const FILL_FALLBACK = "#eef2ff";
const STEP_LABEL_CHARS = 24;

type FlowchartDialogProps = { initial: FlowchartSettings; updating: boolean; onClose: () => void; onSubmit: (source: FlowchartSource) => void; swatchRows?: () => ColorSwatchRow[] };

export function FlowchartDialog({ initial, updating, onClose, onSubmit, swatchRows }: FlowchartDialogProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<FlowchartSettings>(initial);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<RpcError | null>(null);
  const key = useMemo(() => JSON.stringify(toFlowchartSpec(settings)), [settings]);
  const blank = isBlankFlowchart(settings);
  const preview = useEnginePreview(flowchartPreview, key, !blank, attempt);

  const update = (change: Partial<FlowchartSettings>) => setSettings((current) => ({ ...current, ...change }));

  const stepName = (index: number) => {
    const node = settings.nodes[index];
    const text = node.text.replace(/\s+/g, " ").trim();
    const shown = text.length > STEP_LABEL_CHARS ? `${text.slice(0, STEP_LABEL_CHARS)}…` : text || t(`viewer.flowchart.shapes.${node.shape}`);
    return `${index + 1}. ${shown}`;
  };
  const stepOptions = settings.nodes.map((node, index) => ({ value: node.id, label: stepName(index) }));

  const submit = async () => {
    if (blank) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await currentPreview(preview, key, flowchartPreview);
      onSubmit({ settings, svg: result.svg, width: result.width, height: result.height });
    } catch (error) {
      setSubmitError(toRpcError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="xl"
      title={updating ? t("viewer.flowchart.editTitle") : t("viewer.flowchart.title")}
      onClose={onClose}
      footer={
        <>
          {submitError ? <span className="me-auto text-sm text-destructive">{describeError(t, submitError)}</span> : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={busy || blank}>
            {updating ? t("viewer.flowchart.update") : t("viewer.flowchart.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-foreground/80">{t("viewer.flowchart.steps")}</legend>
            <ol className="flex max-h-64 flex-col gap-2 overflow-y-auto pe-1">
              {settings.nodes.map((node, index) => (
                <li key={node.id} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-end font-mono text-xs text-muted-foreground">{index + 1}</span>
                  <Select
                    value={node.shape}
                    options={FLOW_SHAPES.map((shape) => ({ value: shape, label: t(`viewer.flowchart.shapes.${shape}`) }))}
                    onChange={(shape) => setSettings((current) => updateStep(current, node.id, { shape: shape as FlowShape }))}
                    ariaLabel={t("viewer.flowchart.shapeOf", { number: index + 1 })}
                    className="w-36 shrink-0"
                  />
                  <TextInput
                    value={node.text}
                    maxLength={FLOW_LIMITS.nodeChars}
                    onChange={(event) => setSettings((current) => updateStep(current, node.id, { text: event.target.value }))}
                    aria-label={t("viewer.flowchart.stepText", { number: index + 1 })}
                    className="min-w-0 flex-1"
                  />
                  <IconButton icon={Trash2} label={t("viewer.flowchart.removeStep", { number: index + 1 })} disabled={settings.nodes.length <= 1} onClick={() => setSettings((current) => removeStep(current, node.id))} />
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={settings.nodes.length >= FLOW_LIMITS.nodes} onClick={() => setSettings(addStep)}>
                {t("viewer.flowchart.addStep")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("viewer.flowchart.stepsHint")}</span>
            </div>
          </fieldset>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-foreground/80">{t("viewer.flowchart.arrows")}</legend>
            <ol className="flex max-h-64 flex-col gap-2 overflow-y-auto pe-1">
              {settings.edges.map((edge, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Select value={edge.source} options={stepOptions} onChange={(source) => setSettings((current) => updateArrow(current, index, { source }))} ariaLabel={t("viewer.flowchart.arrowFrom", { number: index + 1 })} className="min-w-0 flex-1" />
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <Select value={edge.target} options={stepOptions} onChange={(target) => setSettings((current) => updateArrow(current, index, { target }))} ariaLabel={t("viewer.flowchart.arrowTo", { number: index + 1 })} className="min-w-0 flex-1" />
                  <TextInput
                    value={edge.label}
                    maxLength={FLOW_LIMITS.labelChars}
                    placeholder={t("viewer.flowchart.labelPlaceholder")}
                    onChange={(event) => setSettings((current) => updateArrow(current, index, { label: event.target.value }))}
                    aria-label={t("viewer.flowchart.arrowLabel", { number: index + 1 })}
                    className="w-24 shrink-0"
                  />
                  <IconButton icon={Trash2} label={t("viewer.flowchart.removeArrow", { number: index + 1 })} onClick={() => setSettings((current) => removeArrow(current, index))} />
                </li>
              ))}
            </ol>
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={settings.edges.length >= FLOW_LIMITS.edges || settings.nodes.length < 2} onClick={() => setSettings(addArrow)} className="self-start">
              {t("viewer.flowchart.addArrow")}
            </Button>
          </fieldset>
        </div>
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <EnginePreview state={preview} blank={blank} onRetry={() => setAttempt((value) => value + 1)} label={t("viewer.flowchart.previewLabel")} emptyIcon={Workflow} emptyTitle={t("viewer.flowchart.emptyTitle")} emptyText={t("viewer.flowchart.empty")} />
          </div>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto md:col-span-2">
            <Field label={t("viewer.flowchart.direction")}>
              <Segmented value={settings.direction} options={FLOW_DIRECTIONS} labelOf={(direction) => t(`viewer.flowchart.directions.${direction}`)} onChange={(direction) => update({ direction })} ariaLabel={t("viewer.flowchart.direction")} size="sm" />
            </Field>
            <SliderField label={t("viewer.flowchart.fontSize")} value={settings.fontSize} min={6} max={24} onChange={(fontSize) => update({ fontSize })} format={(value) => `${value} pt`} />
            <Field label={t("viewer.flowchart.font")}>
              <FontPicker value={settings.fontId} onChange={(fontId) => update({ fontId })} />
            </Field>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.color} onChange={(color) => update({ color })} label={t("viewer.flowchart.textColor")} customLabel={t("viewer.overlay.customColor")} rows={swatchRows} />
                {t("viewer.flowchart.textColor")}
              </span>
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.stroke} onChange={(stroke) => update({ stroke })} label={t("viewer.flowchart.lineColor")} customLabel={t("viewer.overlay.customColor")} rows={swatchRows} />
                {t("viewer.flowchart.lineColor")}
              </span>
            </div>
            <SwitchField label={t("viewer.flowchart.fillShapes")} checked={settings.fill !== null} onChange={(on) => update({ fill: on ? FILL_FALLBACK : null })} />
            {settings.fill !== null ? (
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.fill} onChange={(fill) => update({ fill })} label={t("viewer.flowchart.fillColor")} customLabel={t("viewer.overlay.customColor")} rows={swatchRows} />
                {t("viewer.flowchart.fillColor")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

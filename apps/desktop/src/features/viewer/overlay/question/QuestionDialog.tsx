import { useMemo, useState } from "react";
import { Check, ListChecks, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, Segmented, SliderField, SwitchField, TextArea, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { questionPreview } from "@/shared/rpc/operations";
import type { RpcError } from "@/types";
import { EnginePreview } from "../grid/EnginePreview";
import { currentPreview, useEnginePreview } from "../grid/useEnginePreview";
import type { QuestionSource } from "./questionObject";
import { LETTER_CASES, QUESTION_LAYOUTS, QUESTION_LIMITS, addOption, isBlankQuestion, optionLetter, removeOption, setOption, toQuestionSpec, type QuestionSettings } from "./questionModel";

const KINDS = ["choice", "open"] as const;

export function QuestionDialog({ initial, updating, onClose, onSubmit }: { initial: QuestionSettings; updating: boolean; onClose: () => void; onSubmit: (source: QuestionSource) => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<QuestionSettings>(initial);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<RpcError | null>(null);
  const key = useMemo(() => JSON.stringify(toQuestionSpec(settings)), [settings]);
  const blank = isBlankQuestion(settings);
  const preview = useEnginePreview(questionPreview, key, !blank, attempt);

  const update = (change: Partial<QuestionSettings>) => setSettings((current) => ({ ...current, ...change }));

  const submit = async () => {
    if (blank) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await currentPreview(preview, key, questionPreview);
      onSubmit({ settings, svg: result.svg, width: result.width, height: result.height });
    } catch (error) {
      setSubmitError(toRpcError(error));
    } finally {
      setBusy(false);
    }
  };

  const setNumber = (text: string) => {
    const value = Number.parseInt(text, 10);
    update({ number: Number.isFinite(value) ? Math.max(0, Math.min(QUESTION_LIMITS.number, value)) : null });
  };

  return (
    <Dialog
      open
      size="xl"
      title={updating ? t("viewer.question.editTitle") : t("viewer.question.title")}
      onClose={onClose}
      footer={
        <>
          {submitError ? <span className="me-auto text-sm text-destructive">{describeError(t, submitError)}</span> : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={busy || blank}>
            {updating ? t("viewer.question.update") : t("viewer.question.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          <Field label={t("viewer.question.number")} hint={t("viewer.question.numberHint")}>
            <TextInput type="number" min={0} max={QUESTION_LIMITS.number} value={settings.number ?? ""} onChange={(event) => setNumber(event.target.value)} className="w-24 font-mono" />
          </Field>
          <div className="flex flex-col">
            <span aria-hidden className="mb-1.5 block text-sm font-medium text-foreground/80">
              {t("viewer.question.kind")}
            </span>
            <Segmented value={settings.open ? "open" : "choice"} options={KINDS} labelOf={(kind) => t(`viewer.question.kinds.${kind}`)} onChange={(kind) => update({ open: kind === "open" })} ariaLabel={t("viewer.question.kind")} />
          </div>
        </div>
        <Field label={t("viewer.question.stem")}>
          <TextArea rows={3} value={settings.stem} maxLength={QUESTION_LIMITS.stemChars} onChange={(event) => update({ stem: event.target.value })} placeholder={t("viewer.question.stemPlaceholder")} />
        </Field>
        {settings.open ? null : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-foreground/80">{t("viewer.question.options")}</legend>
            <div role="radiogroup" aria-label={t("viewer.question.correct")} className="flex flex-col gap-2">
              {settings.options.map((text, index) => {
                const letter = optionLetter(index, settings.letterCase);
                const correct = settings.answer === index;
                return (
                  <div key={index} className="flex items-center gap-2">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={correct}
                      aria-label={t("viewer.question.markCorrect", { letter })}
                      title={t("viewer.question.markCorrect", { letter })}
                      onClick={() => update({ answer: correct ? null : index })}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-[background-color,color] duration-(--transition-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        correct ? "border-success bg-success/15 text-success" : "hover:bg-secondary",
                      )}
                    >
                      {correct ? <Check className="size-4" aria-hidden /> : letter}
                    </button>
                    <TextInput
                      value={text}
                      maxLength={QUESTION_LIMITS.optionChars}
                      onChange={(event) => setSettings((current) => setOption(current, index, event.target.value))}
                      aria-label={t("viewer.question.optionLabel", { letter })}
                      className="min-w-0 flex-1"
                    />
                    <IconButton icon={Trash2} label={t("viewer.question.removeOption", { letter })} disabled={settings.options.length <= QUESTION_LIMITS.minOptions} onClick={() => setSettings((current) => removeOption(current, index))} />
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={settings.options.length >= QUESTION_LIMITS.options} onClick={() => setSettings(addOption)}>
                {t("viewer.question.addOption")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("viewer.question.correctHint")}</span>
            </div>
          </fieldset>
        )}
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <EnginePreview state={preview} blank={blank} onRetry={() => setAttempt((value) => value + 1)} label={t("viewer.question.previewLabel")} emptyIcon={ListChecks} emptyTitle={t("viewer.question.emptyTitle")} emptyText={t("viewer.question.empty")} />
          </div>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto md:col-span-2">
            {settings.open ? (
              <SliderField label={t("viewer.question.answerLines")} value={settings.answerLines} min={0} max={QUESTION_LIMITS.answerLines} onChange={(answerLines) => update({ answerLines })} />
            ) : (
              <>
                <Field label={t("viewer.question.layout")}>
                  <Select value={settings.layout} options={QUESTION_LAYOUTS.map((layout) => ({ value: layout, label: t(`viewer.question.layouts.${layout}`) }))} onChange={(layout) => update({ layout: layout as QuestionSettings["layout"] })} ariaLabel={t("viewer.question.layout")} />
                </Field>
                <Field label={t("viewer.question.letters")}>
                  <Segmented value={settings.letterCase} options={LETTER_CASES} labelOf={(letterCase) => t(`viewer.question.letterCases.${letterCase}`)} onChange={(letterCase) => update({ letterCase })} ariaLabel={t("viewer.question.letters")} size="sm" />
                </Field>
                <SwitchField label={t("viewer.question.markAnswer")} hint={t("viewer.question.markAnswerHint")} checked={settings.markAnswer} disabled={settings.answer === null} onChange={(markAnswer) => update({ markAnswer })} />
              </>
            )}
            <SliderField label={t("viewer.question.width")} value={settings.width} min={120} max={800} step={10} onChange={(width) => update({ width })} format={(value) => `${value} pt`} />
            <SliderField label={t("viewer.question.fontSize")} value={settings.fontSize} min={6} max={36} onChange={(fontSize) => update({ fontSize })} format={(value) => `${value} pt`} />
            <Field label={t("viewer.question.font")}>
              <FontPicker value={settings.fontId} onChange={(fontId) => update({ fontId })} />
            </Field>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.color} onChange={(color) => update({ color })} label={t("viewer.question.textColor")} customLabel={t("viewer.overlay.customColor")} />
                {t("viewer.question.textColor")}
              </span>
              {settings.open ? (
                <span className="flex items-center gap-2 text-sm">
                  <ColorSwatch value={settings.lineColor} onChange={(lineColor) => update({ lineColor })} label={t("viewer.question.lineColor")} customLabel={t("viewer.overlay.customColor")} />
                  {t("viewer.question.lineColor")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

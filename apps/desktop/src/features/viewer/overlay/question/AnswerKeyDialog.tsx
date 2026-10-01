import { useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { FontPicker } from "@/components/shared/FontPicker";
import { Field, SliderField, SwitchField, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { tablePreview } from "@/shared/rpc/operations";
import type { RpcError } from "@/types";
import { CellGrid } from "../grid/CellGrid";
import { EnginePreview } from "../grid/EnginePreview";
import { currentPreview, useEnginePreview } from "../grid/useEnginePreview";
import { ANSWER_KEY_GROUPS, ANSWER_KEY_LIMITS, applyAnswerKeyEdit, isBlankAnswerKey, toAnswerKeyTable, type AnswerKeySettings } from "./answerKeyModel";
import type { AnswerKeySource } from "./questionObject";

const HEADER_FILL_FALLBACK = "#e5e7eb";

export function AnswerKeyDialog({ initial, updating, onClose, onSubmit }: { initial: AnswerKeySettings; updating: boolean; onClose: () => void; onSubmit: (source: AnswerKeySource) => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AnswerKeySettings>(initial);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<RpcError | null>(null);
  const key = useMemo(() => JSON.stringify(toAnswerKeyTable(settings)), [settings]);
  const blank = isBlankAnswerKey(settings);
  const preview = useEnginePreview(tablePreview, key, !blank, attempt);

  const update = (change: Partial<AnswerKeySettings>) => setSettings((current) => ({ ...current, ...change }));

  const submit = async () => {
    if (blank) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await currentPreview(preview, key, tablePreview);
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
      title={updating ? t("viewer.answerKey.editTitle") : t("viewer.answerKey.title")}
      onClose={onClose}
      footer={
        <>
          {submitError ? <span className="me-auto text-sm text-destructive">{describeError(t, submitError)}</span> : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={busy || blank}>
            {updating ? t("viewer.answerKey.update") : t("viewer.answerKey.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("viewer.answerKey.intro")}</p>
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-2">
            <CellGrid legend={t("viewer.answerKey.entries")} cells={settings.cells} limits={ANSWER_KEY_LIMITS} onEdit={(edit) => setSettings((current) => applyAnswerKeyEdit(current, edit))} headerRow={false} fixedColumns={2} narrow />
          </div>
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto md:col-span-3">
            <EnginePreview state={preview} blank={blank} onRetry={() => setAttempt((value) => value + 1)} label={t("viewer.answerKey.previewLabel")} emptyIcon={KeyRound} emptyTitle={t("viewer.answerKey.emptyTitle")} emptyText={t("viewer.answerKey.empty")} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("viewer.answerKey.numberHeaderLabel")}>
                <TextInput value={settings.numberHeader} maxLength={40} onChange={(event) => update({ numberHeader: event.target.value })} />
              </Field>
              <Field label={t("viewer.answerKey.answerHeaderLabel")}>
                <TextInput value={settings.answerHeader} maxLength={40} onChange={(event) => update({ answerHeader: event.target.value })} />
              </Field>
            </div>
            <SliderField label={t("viewer.answerKey.groups")} value={settings.groups} min={ANSWER_KEY_GROUPS.min} max={ANSWER_KEY_GROUPS.max} onChange={(groups) => update({ groups })} />
            <SliderField label={t("viewer.answerKey.width")} value={settings.width} min={120} max={800} step={10} onChange={(width) => update({ width })} format={(value) => `${value} pt`} />
            <SliderField label={t("viewer.answerKey.fontSize")} value={settings.fontSize} min={6} max={36} onChange={(fontSize) => update({ fontSize })} format={(value) => `${value} pt`} />
            <Field label={t("viewer.answerKey.font")}>
              <FontPicker value={settings.fontId} onChange={(fontId) => update({ fontId })} />
            </Field>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.color} onChange={(color) => update({ color })} label={t("viewer.answerKey.textColor")} customLabel={t("viewer.overlay.customColor")} />
                {t("viewer.answerKey.textColor")}
              </span>
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.borderColor} onChange={(borderColor) => update({ borderColor })} label={t("viewer.answerKey.borderColor")} customLabel={t("viewer.overlay.customColor")} />
                {t("viewer.answerKey.borderColor")}
              </span>
            </div>
            <SwitchField label={t("viewer.answerKey.headerFill")} checked={settings.headerFill !== null} onChange={(on) => update({ headerFill: on ? HEADER_FILL_FALLBACK : null })} />
            {settings.headerFill !== null ? (
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.headerFill} onChange={(headerFill) => update({ headerFill })} label={t("viewer.answerKey.headerFillColor")} customLabel={t("viewer.overlay.customColor")} />
                {t("viewer.answerKey.headerFillColor")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

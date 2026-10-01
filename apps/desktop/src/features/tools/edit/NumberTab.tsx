import { useTranslation } from "react-i18next";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { FontPicker } from "@/components/shared/FontPicker";
import { Checkbox, Field, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { PositionGrid } from "@/components/tool/PositionGrid";
import type { NumberStyle, PageSide, TextPosition } from "@/types";
import { FURNITURE_MARGIN_MM, NUMBER_FONT_SIZE, NUMBER_PADDING, NUMBER_START } from "./editShared";
import type { NumberState, StampState } from "./editFormState";

export function NumberTab({ state, stamp, pages, onPagesChange: setPages, running }: { state: NumberState; stamp: StampState; pages: string; onPagesChange: (value: string) => void; running: boolean }) {
  const { t } = useTranslation();
  const { position, setPosition, template, setTemplate, start, setStart, numberFontSize, setNumberFontSize, numberPrefix, setNumberPrefix, numberPadding, setNumberPadding, numberSuffix, setNumberSuffix, numberStyle, setNumberStyle, numberSide, setNumberSide, numberMirror, setNumberMirror, numberLabels, setNumberLabels, numberReplace, setNumberReplace, numberFontValid, startValid, paddingValid } = state;
  const { marginMm, setMarginMm, color, setColor, bold, setBold, fontId, setFontId, marginValid } = stamp;
  return (
    <Section title={t("tools.edit.number.title")}>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("tools.edit.number.template")} hint={t("tools.edit.number.templateHint")}>
          <TextInput value={template} onChange={(event) => setTemplate(event.target.value)} className="font-mono" />
        </Field>
        <Field label={t("tools.edit.number.start")} hint={startValid ? undefined : t("tools.outOfRange", NUMBER_START)}>
          <TextInput type="number" min={NUMBER_START.min} max={NUMBER_START.max} step={1} value={start} onChange={(event) => setStart(event.target.valueAsNumber)} aria-invalid={!startValid || undefined} className="font-mono" />
        </Field>
        <Field label={t("tools.edit.number.prefix")} hint={t("tools.edit.number.batesHint")}>
          <TextInput value={numberPrefix} onChange={(event) => setNumberPrefix(event.target.value)} className="font-mono" placeholder="DAVA-" />
        </Field>
        <Field label={t("tools.edit.number.style")}>
          <SelectInput value={numberStyle} aria-label={t("tools.edit.number.style")} onChange={(event) => setNumberStyle(event.target.value as NumberStyle)}>
            {(["arabic", "romanLower", "romanUpper", "letterLower", "letterUpper"] as NumberStyle[]).map((value) => (
              <option key={value} value={value}>{t(`tools.edit.number.styles.${value}`)}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t("tools.edit.number.suffixLabel")}>
          <TextInput value={numberSuffix} onChange={(event) => setNumberSuffix(event.target.value)} className="font-mono" placeholder=".a" />
        </Field>
        <Field label={t("tools.side")}>
          <SelectInput value={numberSide} aria-label={t("tools.side")} onChange={(event) => setNumberSide(event.target.value as PageSide)}>
            {(["all", "odd", "even"] as PageSide[]).map((value) => (
              <option key={value} value={value}>{t(`tools.sides.${value}`)}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t("tools.edit.number.padding")} hint={paddingValid ? undefined : t("tools.outOfRange", NUMBER_PADDING)}>
          <TextInput type="number" min={NUMBER_PADDING.min} max={NUMBER_PADDING.max} step={1} value={numberPadding} onChange={(event) => setNumberPadding(event.target.valueAsNumber)} aria-invalid={!paddingValid || undefined} className="font-mono" />
        </Field>
      </div>
      <Field label={t("fontPicker.label")} hint={t("fontPicker.hint")}>
        <FontPicker value={fontId} onChange={setFontId} disabled={running} />
      </Field>
      <div className="grid grid-cols-4 gap-3">
        <Field label={t("tools.fontSize")} hint={numberFontValid ? undefined : t("tools.outOfRange", NUMBER_FONT_SIZE)}>
          <TextInput type="number" min={NUMBER_FONT_SIZE.min} max={NUMBER_FONT_SIZE.max} value={numberFontSize} onChange={(event) => setNumberFontSize(event.target.valueAsNumber)} aria-invalid={!numberFontValid || undefined} className="font-mono" />
        </Field>
        <Field label={t("tools.edit.marginMm")} hint={marginValid ? undefined : t("tools.outOfRange", FURNITURE_MARGIN_MM)}>
          <TextInput type="number" min={FURNITURE_MARGIN_MM.min} max={FURNITURE_MARGIN_MM.max} value={marginMm} onChange={(event) => setMarginMm(event.target.valueAsNumber)} aria-invalid={!marginValid || undefined} className="font-mono" />
        </Field>
        <Field label={t("tools.color")}>
          <ColorSwatch value={color} onChange={setColor} label={t("tools.color")} customLabel={t("colorPicker.custom")} />
        </Field>
        <div className="flex items-end pb-1">
          <Checkbox label={t("tools.bold")} checked={bold} onChange={setBold} />
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <PositionGrid value={position} onChange={(value) => setPosition(value as TextPosition)} label={t("tools.position")} />
        <div className="min-w-56 max-w-md flex-1 space-y-3.5">
          <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
            <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
          </Field>
          <SwitchField label={t("tools.edit.number.mirror")} hint={t("tools.edit.number.mirrorHint")} checked={numberMirror} onChange={setNumberMirror} />
        </div>
      </div>
      <SwitchField label={t("tools.edit.number.pageLabels")} hint={t("tools.edit.number.pageLabelsHint")} checked={numberLabels} onChange={setNumberLabels} />
      <SwitchField label={t("tools.edit.number.replaceExisting")} hint={t("tools.edit.number.replaceExistingHint")} checked={numberReplace} onChange={setNumberReplace} />
    </Section>
  );
}

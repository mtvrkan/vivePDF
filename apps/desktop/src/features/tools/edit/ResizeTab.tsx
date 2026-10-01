import { useTranslation } from "react-i18next";
import { Checkbox, Field, OptionCards, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { FitPreview } from "@/components/tool/FitPreview";
import type { ResizeMode } from "@/types";
import { RESIZE_MARGIN_MM, RESIZE_SIDE_MM } from "./editShared";
import type { ResizeState } from "./editFormState";

export function ResizeTab({ state, pages, onPagesChange: setPages }: { state: ResizeState; pages: string; onPagesChange: (value: string) => void }) {
  const { t } = useTranslation();
  const { preset, setPreset, customSize, setCustomSize, autoRotate, setAutoRotate, resizeMode, setResizeMode, resizeMargin, setResizeMargin, resizeMatchLargest, setResizeMatchLargest, resizeWidthValid, resizeHeightValid, resizeMarginValid } = state;
  return (
    <Section title={t("tools.edit.resize.title")}>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("tools.pages.paperSize")}>
          <SelectInput value={preset} disabled={resizeMatchLargest} onChange={(event) => setPreset(event.target.value)}>
            {["a4", "a3", "a5", "letter", "legal"].map((value) => (
              <option key={value} value={value}>{value.toUpperCase()}</option>
            ))}
            <option value="custom">{t("tools.edit.resize.custom")}</option>
          </SelectInput>
        </Field>
        {preset === "custom" ? (
          <>
            <Field label={t("tools.edit.resize.widthMm")}>
              <TextInput type="number" min={RESIZE_SIDE_MM.min} max={RESIZE_SIDE_MM.max} value={customSize.width} disabled={resizeMatchLargest} aria-invalid={!resizeWidthValid || undefined} onChange={(event) => setCustomSize((state) => ({ ...state, width: Number(event.target.value) }))} className="font-mono" />
            </Field>
            <Field label={t("tools.edit.resize.heightMm")}>
              <TextInput type="number" min={RESIZE_SIDE_MM.min} max={RESIZE_SIDE_MM.max} value={customSize.height} disabled={resizeMatchLargest} aria-invalid={!resizeHeightValid || undefined} onChange={(event) => setCustomSize((state) => ({ ...state, height: Number(event.target.value) }))} className="font-mono" />
            </Field>
          </>
        ) : null}
      </div>
      <OptionCards
        value={resizeMode}
        onChange={setResizeMode}
        ariaLabel={t("tools.edit.resize.mode")}
        options={(["fit", "fill", "stretch", "box"] as ResizeMode[]).map((value) => ({
          value,
          title: t(`tools.edit.resize.modes.${value}`),
          description: t(`tools.edit.resize.modeHints.${value}`),
          preview: <FitPreview mode={value} />,
        }))}
      />
      <Field label={t("tools.edit.resize.margin")}>
        <TextInput type="number" min={RESIZE_MARGIN_MM.min} max={RESIZE_MARGIN_MM.max} value={resizeMargin} disabled={resizeMode === "box"} aria-invalid={!resizeMarginValid || undefined} onChange={(event) => setResizeMargin(Number(event.target.value))} className="w-40 font-mono" />
      </Field>
      <SwitchField label={t("tools.edit.resize.matchLargest")} hint={t("tools.edit.resize.matchLargestHint")} checked={resizeMatchLargest} onChange={setResizeMatchLargest} />
      <Checkbox label={t("tools.edit.resize.autoRotate")} checked={autoRotate} onChange={setAutoRotate} />
      <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
        <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="w-64 font-mono" />
      </Field>
    </Section>
  );
}

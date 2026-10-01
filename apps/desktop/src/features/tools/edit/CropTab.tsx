import { useTranslation } from "react-i18next";
import { Field, Fieldset, OptionCards, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { InsetBox } from "@/components/tool/InsetBox";
import type { PageSide } from "@/types";
import { CROP_AUTO_MARGIN_MM, CROP_INSET_MM } from "./editShared";
import type { CropState } from "./editFormState";

export function CropTab({ state, pages, onPagesChange: setPages }: { state: CropState; pages: string; onPagesChange: (value: string) => void }) {
  const { t } = useTranslation();
  const { insets, setInsets, cropMode, setCropMode, cropSide, setCropSide, cropAutoMargin, setCropAutoMargin, cropRemoveContent, setCropRemoveContent, cropAutoMarginValid } = state;
  return (
    <Section title={t("tools.edit.crop.title")}>
      <OptionCards
        value={cropMode}
        onChange={setCropMode}
        ariaLabel={t("tools.edit.crop.mode")}
        options={[
          { value: "insets", title: t("tools.edit.crop.modes.insets"), description: t("tools.edit.crop.modes.insetsHint") },
          { value: "auto", title: t("tools.edit.crop.modes.auto"), description: t("tools.edit.crop.modes.autoHint") },
        ]}
      />
      {cropMode === "insets" ? (
        <Fieldset title={t("tools.edit.crop.insets")}>
          <InsetBox values={insets} max={CROP_INSET_MM.max} onChange={(side, value) => setInsets((state) => ({ ...state, [side]: value }))} sideLabel={(side) => t(`tools.edit.sides.${side}`)} unit="mm" />
        </Fieldset>
      ) : (
        <Field label={t("tools.edit.crop.autoMargin")} hint={t("tools.edit.crop.autoMarginHint")}>
          <TextInput type="number" min={CROP_AUTO_MARGIN_MM.min} max={CROP_AUTO_MARGIN_MM.max} value={cropAutoMargin} aria-invalid={!cropAutoMarginValid || undefined} onChange={(event) => setCropAutoMargin(Number(event.target.value))} className="w-40 font-mono" />
        </Field>
      )}
      <SwitchField label={t("tools.edit.crop.removeContent")} hint={t("tools.edit.crop.removeContentHint")} checked={cropRemoveContent} onChange={setCropRemoveContent} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
          <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
        </Field>
        <Field label={t("tools.side")}>
          <SelectInput value={cropSide} aria-label={t("tools.side")} onChange={(event) => setCropSide(event.target.value as PageSide)}>
            {(["all", "odd", "even"] as PageSide[]).map((value) => (
              <option key={value} value={value}>{t(`tools.sides.${value}`)}</option>
            ))}
          </SelectInput>
        </Field>
      </div>
    </Section>
  );
}

import { useTranslation } from "react-i18next";
import { Field, Section, SelectInput, SliderField, SwitchField } from "@/components/tool/form";
import type { FlattenImageFormat } from "@/types";
import type { FlattenState } from "./editFormState";

export function FlattenTab({ state }: { state: FlattenState }) {
  const { t } = useTranslation();
  const { flattenAnnotations, setFlattenAnnotations, flattenForms, setFlattenForms, flattenKeepLinks, setFlattenKeepLinks, flattenRasterize, setFlattenRasterize, flattenDpi, setFlattenDpi, flattenImageFormat, setFlattenImageFormat, flattenQuality, setFlattenQuality, flattenPrintedOnly, setFlattenPrintedOnly } = state;
  return (
    <Section title={t("tools.edit.flatten.title")}>
      <p className="text-xs text-muted-foreground">{t("tools.edit.flatten.hint")}</p>
      <SwitchField label={t("tools.edit.flatten.annotations")} checked={flattenAnnotations || flattenRasterize} onChange={setFlattenAnnotations} disabled={flattenRasterize} />
      <SwitchField label={t("tools.edit.flatten.forms")} checked={flattenForms || flattenRasterize} onChange={setFlattenForms} disabled={flattenRasterize} />
      <SwitchField label={t("tools.edit.flatten.printedOnly")} hint={t("tools.edit.flatten.printedOnlyHint")} checked={flattenPrintedOnly} onChange={setFlattenPrintedOnly} disabled={!flattenAnnotations && !flattenForms && !flattenRasterize} />
      <SwitchField label={t("tools.edit.flatten.keepLinks")} hint={t("tools.edit.flatten.keepLinksHint")} checked={flattenKeepLinks} onChange={setFlattenKeepLinks} />
      <SwitchField label={t("tools.edit.flatten.rasterize")} hint={t("tools.edit.flatten.rasterizeHint")} checked={flattenRasterize} onChange={setFlattenRasterize} />
      {flattenRasterize ? (
        <Field label={t("tools.edit.flatten.dpi")} hint={t("tools.edit.flatten.dpiHint")}>
          <SelectInput value={String(flattenDpi)} aria-label={t("tools.edit.flatten.dpi")} onChange={(event) => setFlattenDpi(Number(event.target.value))}>
            {[100, 150, 200, 300].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      {flattenRasterize ? (
        <Field label={t("tools.edit.flatten.imageFormat")} hint={t(`tools.edit.flatten.imageFormats.${flattenImageFormat}Hint`)}>
          <SelectInput value={flattenImageFormat} aria-label={t("tools.edit.flatten.imageFormat")} onChange={(event) => setFlattenImageFormat(event.target.value as FlattenImageFormat)}>
            {(["auto", "jpeg", "png"] as const).map((value) => (
              <option key={value} value={value}>{t(`tools.edit.flatten.imageFormats.${value}`)}</option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      {flattenRasterize && flattenImageFormat !== "png" ? (
        <SliderField label={t("tools.edit.flatten.jpegQuality")} hint={t("tools.edit.flatten.jpegQualityHint")} value={flattenQuality} min={30} max={100} step={5} onChange={setFlattenQuality} format={(value) => String(value)} />
      ) : null}
    </Section>
  );
}

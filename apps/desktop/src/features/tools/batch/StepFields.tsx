import { useTranslation } from "react-i18next";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Field, SelectInput, SliderField, TextInput } from "@/components/tool/form";
import { PageSlots, type SlotSide } from "@/components/tool/PageSlots";
import type { PdfaLevel, WatermarkPosition } from "@/types";
import { MARK_POSITIONS, PDFA_LEVELS, type StepSettings } from "./chain";

type StepFieldsProps = { settings: StepSettings; onChange: (patch: Partial<StepSettings>) => void };

const percent = (value: number) => `${value}%`;
const degrees = (value: number) => `${value}°`;
const SLOT_KEYS = {
  header: { left: "headerLeft", center: "headerCenter", right: "headerRight" },
  footer: { left: "footerLeft", center: "footerCenter", right: "footerRight" },
} as const satisfies Record<"header" | "footer", Record<SlotSide, keyof StepSettings>>;

export function WatermarkStepFields({ settings, onChange }: StepFieldsProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("tools.security.watermark.text")} className="sm:col-span-2">
          <TextInput value={settings.markText} onChange={(event) => onChange({ markText: event.target.value })} placeholder={t("tools.security.watermark.textPlaceholder")} />
        </Field>
        <Field label={t("tools.fontSize")}>
          <TextInput type="number" min={6} max={200} value={settings.markFontSize} onChange={(event) => onChange({ markFontSize: Math.min(200, Math.max(6, Number(event.target.value) || 6)) })} className="font-mono" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SliderField label={t("tools.mark.opacity")} value={settings.markOpacity} min={2} max={100} onChange={(value) => onChange({ markOpacity: value })} format={percent} />
        <SliderField label={t("tools.mark.rotation")} value={settings.markRotation} min={-90} max={90} onChange={(value) => onChange({ markRotation: value })} format={degrees} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.position")}>
          <SelectInput value={settings.markPosition} onChange={(event) => onChange({ markPosition: event.target.value as WatermarkPosition })}>
            {MARK_POSITIONS.map((value) => (
              <option key={value} value={value}>
                {t(`tools.mark.positions.${value}`)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t("tools.color")}>
          <ColorSwatch value={settings.markColor} onChange={(value) => onChange({ markColor: value })} label={t("tools.color")} customLabel={t("colorPicker.custom")} />
        </Field>
      </div>
    </div>
  );
}

export function HeaderFooterStepFields({ settings, onChange }: StepFieldsProps) {
  const { t } = useTranslation();
  const row = (name: "header" | "footer") => ({ left: settings[SLOT_KEYS[name].left], center: settings[SLOT_KEYS[name].center], right: settings[SLOT_KEYS[name].right] });
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("tools.edit.headerFooter.hint")}</p>
      <PageSlots
        header={row("header")}
        footer={row("footer")}
        onHeader={(side, value) => onChange({ [SLOT_KEYS.header[side]]: value })}
        onFooter={(side, value) => onChange({ [SLOT_KEYS.footer[side]]: value })}
        headerLabel={t("tools.edit.headerFooter.header")}
        footerLabel={t("tools.edit.headerFooter.footer")}
        sideLabel={(side) => t(`tools.edit.headerFooter.${side}`)}
      />
      <Field label={t("tools.fontSize")} className="w-32">
        <TextInput type="number" min={4} max={48} value={settings.furnitureFontSize} onChange={(event) => onChange({ furnitureFontSize: Math.min(48, Math.max(4, Number(event.target.value) || 4)) })} className="font-mono" />
      </Field>
    </div>
  );
}

export function MetadataStepFields({ settings, onChange }: StepFieldsProps) {
  const { t } = useTranslation();
  const fields = [
    { key: "metaTitle", label: t("viewer.metadata.fields.title") },
    { key: "metaAuthor", label: t("viewer.metadata.fields.author") },
    { key: "metaSubject", label: t("viewer.metadata.fields.subject") },
    { key: "metaKeywords", label: t("viewer.metadata.fields.keywords") },
  ] as const;
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} label={field.label}>
            <TextInput value={settings[field.key]} onChange={(event) => onChange({ [field.key]: event.target.value })} />
          </Field>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("tools.batch.metadataHint")}</p>
    </div>
  );
}

export function PdfaStepFields({ settings, onChange }: StepFieldsProps) {
  const { t } = useTranslation();
  return (
    <Field label={t("tools.pdfa.level")} hint={t(`tools.pdfa.levels.${settings.pdfaLevel}`)}>
      <SelectInput value={settings.pdfaLevel} onChange={(event) => onChange({ pdfaLevel: event.target.value as PdfaLevel })} className="w-44">
        {PDFA_LEVELS.map((value) => (
          <option key={value} value={value}>
            {`PDF/A-${value}`}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}

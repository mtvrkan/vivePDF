import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { FontPicker } from "@/components/shared/FontPicker";
import { Field, OptionCards, Section, SelectInput, SliderField, SwitchField, TextArea, TextInput } from "@/components/tool/form";
import { MarkFields } from "@/features/tools/security/MarkFields";
import { FLATTEN_DPIS } from "@/features/tools/security/markPresetStore";
import { basenameOf } from "@/shared/lib/paths";
import type { PageSide, WatermarkKind, WatermarkPosition, WatermarkVisibility } from "@/types";

const percent = (value: number) => value + "%";
const VISIBILITIES: WatermarkVisibility[] = ["always", "print", "screen"];

export type WatermarkForm = {
  kind: WatermarkKind;
  templatePath: string;
  templatePage: number;
  text: string;
  imagePath: string;
  fontId: string;
  fontSize: number;
  bold: boolean;
  color: string;
  opacity: number;
  rotation: number;
  position: WatermarkPosition;
  scale: number;
  tileGap: number;
  offsetX: number;
  offsetY: number;
  behind: boolean;
  pages: string;
  side: PageSide;
  flatten: boolean;
  flattenDpi: number;
  visibility: WatermarkVisibility;
};

export type WatermarkSetters = {
  [Key in keyof WatermarkForm as `set${Capitalize<Key>}`]: (value: WatermarkForm[Key]) => void;
};

export function WatermarkSection({ form, set, busy, presets }: {
  form: WatermarkForm;
  set: WatermarkSetters;
  busy: boolean;
  presets: ReactNode;
}) {
  const { t } = useTranslation();

  const pickTemplate = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof selected === "string") set.setTemplatePath(selected);
  };

  const pickImage = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "heic", "heif"] }] });
    if (typeof selected === "string") set.setImagePath(selected);
  };

  return (
    <Section title={t("tools.security.watermark.title")}>
      <OptionCards
        value={form.kind}
        onChange={set.setKind}
        ariaLabel={t("tools.security.watermark.kind")}
        options={[
          { value: "text", title: t("tools.security.watermark.text"), description: t("tools.security.watermark.textDescription") },
          { value: "image", title: t("tools.security.watermark.image"), description: t("tools.security.watermark.imageDescription") },
          { value: "pdf", title: t("tools.security.watermark.pdf"), description: t("tools.security.watermark.pdfDescription") },
        ]}
      />
      {form.kind === "pdf" ? (
        <div className="grid grid-cols-[1fr_auto_8rem] gap-3">
          <Field label={t("tools.security.watermark.template")} hint={t("tools.security.watermark.templateHint")}>
            <TextInput value={form.templatePath} onChange={(event) => set.setTemplatePath(event.target.value)} placeholder={t("tools.security.watermark.templatePlaceholder")} className="font-mono text-sm" />
          </Field>
          <div className="flex items-end pb-1">
            <Button variant="ghost" onClick={() => void pickTemplate()}>{t("tools.browse")}</Button>
          </div>
          <Field label={t("tools.security.watermark.templatePage")}>
            <TextInput type="number" min={1} value={form.templatePage} onChange={(event) => set.setTemplatePage(Math.max(1, Number(event.target.value) || 1))} className="font-mono" />
          </Field>
        </div>
      ) : null}
      {form.kind === "text" ? (
        <>
          <Field label={t("tools.security.watermark.text")} hint={t("tools.security.watermark.multiline")}>
            <TextArea value={form.text} onChange={(event) => set.setText(event.target.value)} placeholder={t("tools.security.watermark.textPlaceholder")} rows={2} />
          </Field>
          <Field label={t("fontPicker.label")} hint={t("fontPicker.hint")}>
            <FontPicker value={form.fontId} onChange={set.setFontId} disabled={busy} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("tools.fontSize")}>
              <TextInput type="number" min={4} max={400} value={form.fontSize} onChange={(event) => set.setFontSize(Number(event.target.value))} className="font-mono" />
            </Field>
            <Field label={t("tools.color")}>
              <ColorSwatch value={form.color} onChange={set.setColor} label={t("tools.color")} customLabel={t("colorPicker.custom")} />
            </Field>
          </div>
          <SwitchField label={t("tools.bold")} checked={form.bold} onChange={set.setBold} />
        </>
      ) : null}
      {form.kind === "image" ? (
        <Field label={t("tools.security.watermark.imageFile")}>
          <div className="flex gap-2">
            <TextInput value={form.imagePath ? basenameOf(form.imagePath) : ""} readOnly className="font-mono text-sm" />
            <Button onClick={() => void pickImage()}>{t("tools.browse")}</Button>
          </div>
        </Field>
      ) : null}
      <MarkFields
        opacity={form.opacity}
        onOpacity={set.setOpacity}
        opacityMin={2}
        rotation={form.rotation}
        onRotation={set.setRotation}
        rotationLimit={90}
        position={form.position}
        onPosition={set.setPosition}
        tile
        tileGap={form.tileGap}
        onTileGap={set.setTileGap}
        offsetX={form.offsetX}
        onOffsetX={set.setOffsetX}
        offsetY={form.offsetY}
        onOffsetY={set.setOffsetY}
        behind={form.behind}
        onBehind={set.setBehind}
        pages={form.pages}
        onPages={set.setPages}
        side={form.side}
        onSide={set.setSide}
      >
        {form.kind === "image" ? (
          <SliderField label={t("tools.security.watermark.scale")} value={form.scale} min={5} max={100} onChange={set.setScale} format={percent} />
        ) : null}
      </MarkFields>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.security.watermark.visibility")} hint={form.flatten ? t("tools.security.watermark.visibilityFlattenHint") : undefined}>
          <SelectInput value={form.flatten ? "always" : form.visibility} disabled={form.flatten} aria-label={t("tools.security.watermark.visibility")} onChange={(event) => set.setVisibility(event.target.value as WatermarkVisibility)}>
            {VISIBILITIES.map((value) => (
              <option key={value} value={value}>
                {t(`tools.security.watermark.visibilities.${value}`)}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <SwitchField label={t("tools.security.watermark.flatten")} hint={t("tools.security.watermark.flattenHint")} checked={form.flatten} onChange={set.setFlatten} />
      {form.flatten ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("tools.security.watermark.flattenDpi")}>
            <SelectInput value={form.flattenDpi} aria-label={t("tools.security.watermark.flattenDpi")} onChange={(event) => set.setFlattenDpi(Number(event.target.value))}>
              {FLATTEN_DPIS.map((value) => (
                <option key={value} value={value}>
                  {t("tools.security.watermark.dpiValue", { dpi: value })}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
      ) : null}
      {presets}
    </Section>
  );
}

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { FontPicker } from "@/components/shared/FontPicker";
import { Field, SelectInput, Section, SwitchField, TextArea, TextInput } from "@/components/tool/form";
import { MarkFields } from "@/features/tools/security/MarkFields";
import { cn } from "@/shared/lib/cn";
import { DATE_FORMATS } from "@/shared/lib/dateFormats";
import type { PageSide, StampPosition } from "@/types";

const STAMP_TEXT_MAX_LENGTH = 120;
const STAMP_PRESETS: Array<{ id: string; color: string }> = [
  { id: "approved", color: "#1e8449" },
  { id: "draft", color: "#7f8c8d" },
  { id: "confidential", color: "#c0392b" },
  { id: "paid", color: "#1e8449" },
  { id: "copy", color: "#2e86c1" },
  { id: "urgent", color: "#c0392b" },
  { id: "received", color: "#2e86c1" },
  { id: "reviewed", color: "#8e44ad" },
];

export type StampForm = {
  stampPreset: string;
  stampText: string;
  stampName: string;
  stampFontId: string;
  stampSize: number;
  stampColor: string;
  stampOpacity: number;
  stampRotation: number;
  stampPosition: StampPosition;
  stampOffsetX: number;
  stampOffsetY: number;
  stampBehind: boolean;
  stampPages: string;
  stampSide: PageSide;
  stampBorder: boolean;
  stampDateFormat: string;
};

export type StampSetters = {
  [Key in keyof StampForm as `set${Capitalize<Key>}`]: (value: StampForm[Key]) => void;
};

export function StampSection({ form, set, busy, presets }: {
  form: StampForm;
  set: StampSetters;
  busy: boolean;
  presets: ReactNode;
}) {
  const { t } = useTranslation();

  const applyStampPreset = (id: string) => {
    const preset = STAMP_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    set.setStampPreset(id);
    set.setStampText(t(`tools.security.stamp.presets.${id}`));
    set.setStampColor(preset.color);
  };

  const editStampText = (value: string) => {
    set.setStampPreset("");
    set.setStampText(value);
  };

  const editStampColor = (value: string) => {
    set.setStampPreset("");
    set.setStampColor(value);
  };

  return (
    <Section title={t("tools.security.stamp.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.security.stamp.description")}</p>
      <div className="flex flex-wrap gap-2">
        {STAMP_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => applyStampPreset(preset.id)}
            aria-pressed={form.stampPreset === preset.id}
            className={cn(
              "h-8 rounded-full border px-3 text-xs font-semibold uppercase tracking-wide transition-colors duration-(--transition-fast)",
              form.stampPreset === preset.id ? "border-(--tone) bg-(--tone-soft)" : "border-(--glass-border) bg-card/60 hover:bg-secondary",
            )}
            style={{ color: `color-mix(in oklab, ${preset.color} 70%, var(--foreground))` }}
          >
            {t(`tools.security.stamp.presets.${preset.id}`)}
          </button>
        ))}
      </div>
      <Field label={t("tools.security.stamp.text")} hint={t("tools.security.stamp.textHint")}>
        <TextArea value={form.stampText} onChange={(event) => editStampText(event.target.value)} maxLength={STAMP_TEXT_MAX_LENGTH} rows={2} />
      </Field>
      <Field label={t("tools.security.stamp.name")} hint={t("tools.security.stamp.nameHint")}>
        <TextInput value={form.stampName} maxLength={120} onChange={(event) => set.setStampName(event.target.value)} />
      </Field>
      <Field label={t("tools.security.stamp.dateFormat")} hint={t("tools.security.stamp.dateFormatHint")}>
        <SelectInput value={form.stampDateFormat} aria-label={t("tools.security.stamp.dateFormat")} onChange={(event) => set.setStampDateFormat(event.target.value)} className="font-mono">
          {DATE_FORMATS.map((format) => (
            <option key={format.value} value={format.value}>{format.label}</option>
          ))}
        </SelectInput>
      </Field>
      <Field label={t("fontPicker.label")} hint={t("fontPicker.hint")}>
        <FontPicker value={form.stampFontId} onChange={set.setStampFontId} disabled={busy} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.fontSize")}>
          <TextInput type="number" min={6} max={200} value={form.stampSize} onChange={(event) => set.setStampSize(Number(event.target.value))} className="font-mono" />
        </Field>
        <Field label={t("tools.color")}>
          <ColorSwatch value={form.stampColor} onChange={editStampColor} label={t("tools.color")} customLabel={t("colorPicker.custom")} />
        </Field>
      </div>
      <MarkFields
        opacity={form.stampOpacity}
        onOpacity={set.setStampOpacity}
        opacityMin={10}
        rotation={form.stampRotation}
        onRotation={set.setStampRotation}
        rotationLimit={45}
        position={form.stampPosition}
        onPosition={(value) => set.setStampPosition(value as StampPosition)}
        offsetX={form.stampOffsetX}
        onOffsetX={set.setStampOffsetX}
        offsetY={form.stampOffsetY}
        onOffsetY={set.setStampOffsetY}
        behind={form.stampBehind}
        onBehind={set.setStampBehind}
        pages={form.stampPages}
        onPages={set.setStampPages}
        side={form.stampSide}
        onSide={set.setStampSide}
      >
        <SwitchField label={t("tools.security.stamp.border")} checked={form.stampBorder} onChange={set.setStampBorder} />
      </MarkFields>
      {presets}
    </Section>
  );
}

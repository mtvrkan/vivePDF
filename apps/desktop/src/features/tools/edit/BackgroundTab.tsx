import { useTranslation } from "react-i18next";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Field, OptionCards, Section, TextInput } from "@/components/tool/form";

export type BackgroundMode = "add" | "remove";
export type BackgroundSettings = { mode: BackgroundMode; color: string };

const BACKGROUND_PRESETS = ["#fff8e1", "#fdf1e4", "#fdecec", "#f3ecfb", "#e8f1fd", "#e6f6ef", "#f4f4f0", "#eef0f3", "#fffde7", "#e0f7fa", "#fce4ec", "#ffffff"];

export function BackgroundTab({ settings, onChange, pages, onPagesChange }: { settings: BackgroundSettings; onChange: (patch: Partial<BackgroundSettings>) => void; pages: string; onPagesChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <Section title={t("tools.edit.background.title")}>
      <OptionCards
        value={settings.mode}
        onChange={(mode) => onChange({ mode })}
        ariaLabel={t("tools.edit.background.mode")}
        options={[
          { value: "add", title: t("tools.edit.background.modes.add"), description: t("tools.edit.background.modeHints.add") },
          { value: "remove", title: t("tools.edit.background.modes.remove"), description: t("tools.edit.background.modeHints.remove") },
        ]}
      />
      {settings.mode === "add" ? (
        <Field label={t("tools.color")} hint={t("tools.edit.background.colorHint")}>
          <ColorSwatch value={settings.color} onChange={(color) => onChange({ color })} label={t("tools.color")} customLabel={t("colorPicker.custom")} presets={BACKGROUND_PRESETS} />
        </Field>
      ) : null}
      <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
        <TextInput value={pages} onChange={(event) => onPagesChange(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
      </Field>
    </Section>
  );
}

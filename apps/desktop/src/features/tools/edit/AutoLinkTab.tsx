import { useTranslation } from "react-i18next";
import { Field, Section, SwitchField, TextInput } from "@/components/tool/form";

export type AutoLinkSettings = { urls: boolean; emails: boolean; pages: string };

export function AutoLinkTab({ settings, onChange }: { settings: AutoLinkSettings; onChange: (patch: Partial<AutoLinkSettings>) => void }) {
  const { t } = useTranslation();
  const nothingChosen = !settings.urls && !settings.emails;
  return (
    <Section title={t("tools.edit.autolink.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.edit.autolink.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchField label={t("tools.edit.autolink.urls")} hint={t("tools.edit.autolink.urlsHint")} checked={settings.urls} onChange={(urls) => onChange({ urls })} />
        <SwitchField label={t("tools.edit.autolink.emails")} hint={t("tools.edit.autolink.emailsHint")} checked={settings.emails} onChange={(emails) => onChange({ emails })} />
      </div>
      {nothingChosen ? <p role="alert" className="text-sm text-destructive">{t("tools.edit.autolink.chooseOne")}</p> : null}
      <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
        <TextInput value={settings.pages} onChange={(event) => onChange({ pages: event.target.value })} placeholder={t("tools.allPages")} className="font-mono" />
      </Field>
    </Section>
  );
}

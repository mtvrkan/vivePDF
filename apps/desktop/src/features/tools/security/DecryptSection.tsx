import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/components/shared/PasswordInput";
import { Field, Section } from "@/components/tool/form";

export function DecryptSection({ password, onPassword, documentHasPassword, ownerOnly = false }: {
  password: string;
  onPassword: (value: string) => void;
  documentHasPassword: boolean;
  ownerOnly?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t("tools.security.decrypt.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.security.decrypt.hint")}</p>
      {ownerOnly ? <p className="text-sm text-muted-foreground">{t("tools.security.decrypt.ownerOnly")}</p> : null}
      <Field label={ownerOnly ? t("tools.security.decrypt.ownerOnlyPassword") : t("password.label")}>
        <PasswordInput value={password} onChange={(event) => onPassword(event.target.value)} placeholder={documentHasPassword ? "••••••" : ""} autoComplete="off" />
      </Field>
    </Section>
  );
}

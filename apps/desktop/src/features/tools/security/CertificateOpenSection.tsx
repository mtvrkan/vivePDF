import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { PasswordInput } from "@/components/shared/PasswordInput";
import { Field, Section, TextInput } from "@/components/tool/form";
import { basenameOf } from "@/shared/lib/paths";

export function CertificateOpenSection({ sealedPath, onSealedPath, holderPath, onHolderPath, holderPassword, onHolderPassword }: {
  sealedPath: string;
  onSealedPath: (value: string) => void;
  holderPath: string;
  onHolderPath: (value: string) => void;
  holderPassword: string;
  onHolderPassword: (value: string) => void;
}) {
  const { t } = useTranslation();

  const pickSealed = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof selected === "string") onSealedPath(selected);
  };

  const pickHolder = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PKCS#12", extensions: ["p12", "pfx"] }] });
    if (typeof selected === "string") onHolderPath(selected);
  };

  return (
    <Section title={t("tools.security.decryptCertificate.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.security.decryptCertificate.hint")}</p>
      <Field label={t("tools.security.decryptCertificate.file")} hint={t("tools.security.decryptCertificate.fileHint")}>
        <div className="flex gap-2">
          <TextInput value={sealedPath ? basenameOf(sealedPath) : ""} readOnly className="font-mono text-sm" />
          <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickSealed()}>{t("tools.browse")}</Button>
        </div>
      </Field>
      <Field label={t("tools.security.decryptCertificate.certificateFile")} hint={t("tools.security.decryptCertificate.certificateHint")}>
        <div className="flex gap-2">
          <TextInput value={holderPath ? basenameOf(holderPath) : ""} readOnly className="font-mono text-sm" />
          <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickHolder()}>{t("tools.browse")}</Button>
        </div>
      </Field>
      <Field label={t("tools.security.decryptCertificate.certificatePassword")} hint={t("tools.security.decryptCertificate.certificatePasswordHint")}>
        <PasswordInput value={holderPassword} onChange={(event) => onHolderPassword(event.target.value)} autoComplete="off" className="max-w-xs" />
      </Field>
    </Section>
  );
}

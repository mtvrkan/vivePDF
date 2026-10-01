import type { Dispatch, SetStateAction } from "react";
import { BadgeCheck, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Fieldset, Section } from "@/components/tool/form";
import { AlgorithmAndMetadata, PermissionsFieldset } from "@/features/tools/security/EncryptionOptions";
import { sealAlgorithm } from "@/features/tools/security/securityForm";
import { basenameOf } from "@/shared/lib/paths";
import type { EncryptAlgorithm, Permissions } from "@/types";

export function CertificateSealSection({
  recipients,
  onRecipients,
  algorithm,
  onAlgorithm,
  encryptMetadata,
  onEncryptMetadata,
  permissions,
  onPermissions,
}: {
  recipients: string[];
  onRecipients: Dispatch<SetStateAction<string[]>>;
  algorithm: EncryptAlgorithm;
  onAlgorithm: (value: EncryptAlgorithm) => void;
  encryptMetadata: boolean;
  onEncryptMetadata: (value: boolean) => void;
  permissions: Permissions;
  onPermissions: Dispatch<SetStateAction<Permissions>>;
}) {
  const { t } = useTranslation();

  const pickRecipients = async () => {
    const chosen = await openDialog({ multiple: true, directory: false, filters: [{ name: t("tools.security.certificate.filter"), extensions: ["cer", "crt", "pem", "der"] }] });
    if (!chosen) return;
    const added = Array.isArray(chosen) ? chosen : [chosen];
    onRecipients((state) => [...state, ...added.filter((entry) => !state.includes(entry))]);
  };

  return (
    <Section title={t("tools.security.certificate.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.security.certificate.hint")}</p>
      <Fieldset title={t("tools.security.certificate.recipients")}>
        {recipients.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/60 px-3.5 py-3">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <BadgeCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">{t("tools.security.certificate.empty")}</span>
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => void pickRecipients()}>{t("tools.security.certificate.add")}</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <ul className="space-y-1.5">
              {recipients.map((entry) => (
                <li key={entry} className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/60 py-1.5 pe-1.5 ps-2.5">
                  <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden />
                  <span title={entry} className="min-w-0 flex-1 truncate font-mono text-xs">{basenameOf(entry)}</span>
                  <IconButton icon={X} label={t("common.delete")} onClick={() => onRecipients((state) => state.filter((item) => item !== entry))} />
                </li>
              ))}
            </ul>
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => void pickRecipients()}>{t("tools.security.certificate.add")}</Button>
          </div>
        )}
      </Fieldset>
      <AlgorithmAndMetadata algorithm={sealAlgorithm(algorithm)} onAlgorithm={onAlgorithm} encryptMetadata={encryptMetadata} onEncryptMetadata={onEncryptMetadata} allowRc4={false} />
      <PermissionsFieldset permissions={permissions} onPermissions={onPermissions} />
    </Section>
  );
}

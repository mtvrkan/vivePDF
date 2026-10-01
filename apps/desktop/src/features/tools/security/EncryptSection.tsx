import { useState, type Dispatch, type SetStateAction } from "react";
import { Check, Copy, Info, KeyRound, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { PasswordBreachAlert } from "@/components/shared/PasswordBreachNote";
import { PasswordInput } from "@/components/shared/PasswordInput";
import { Field, Section } from "@/components/tool/form";
import { AlgorithmAndMetadata, PermissionsFieldset } from "@/features/tools/security/EncryptionOptions";
import { isRestricted } from "@/features/tools/security/permissionSets";
import { legacyPasswordEncodable, ownerRepeatsUser, passwordByteLimit, passwordTooLong } from "@/features/tools/security/securityForm";
import { usePasswordBreach } from "@/shared/hooks/usePasswordBreach";
import { cn } from "@/shared/lib/cn";
import { passwordStrength } from "@/shared/lib/passwordStrength";
import type { EncryptAlgorithm, Permissions } from "@/types";

const STRENGTH_STEP = { weak: 0, fair: 1, good: 2, strong: 3 } as const;
const STRENGTH_COLOR = { weak: "bg-destructive", fair: "bg-warning", good: "bg-warning", strong: "bg-success" } as const;

export function EncryptSection({
  userPassword,
  onUserPassword,
  confirmPassword,
  onConfirmPassword,
  ownerPassword,
  onOwnerPassword,
  algorithm,
  onAlgorithm,
  encryptMetadata,
  onEncryptMetadata,
  permissions,
  onPermissions,
}: {
  userPassword: string;
  onUserPassword: (value: string) => void;
  confirmPassword: string;
  onConfirmPassword: (value: string) => void;
  ownerPassword: string;
  onOwnerPassword: (value: string) => void;
  algorithm: EncryptAlgorithm;
  onAlgorithm: (value: EncryptAlgorithm) => void;
  encryptMetadata: boolean;
  onEncryptMetadata: (value: boolean) => void;
  permissions: Permissions;
  onPermissions: Dispatch<SetStateAction<Permissions>>;
}) {
  const { t } = useTranslation();
  const legacyCharset = algorithm !== "aes256" && !(legacyPasswordEncodable(userPassword) && legacyPasswordEncodable(ownerPassword));
  const tooLong = passwordTooLong(userPassword, algorithm) || passwordTooLong(ownerPassword, algorithm);
  const restricted = isRestricted(permissions);
  const sameOwner = ownerRepeatsUser(userPassword, ownerPassword, restricted);
  const userBreach = usePasswordBreach(userPassword);
  const ownerBreach = usePasswordBreach(ownerPassword);
  const strength = passwordStrength(userPassword, userBreach.breached);
  return (
    <Section title={t("tools.security.encrypt.title")}>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t("tools.security.encrypt.userPassword")}
          hint={t("tools.security.encrypt.userPasswordHint")}
          note={userPassword.length > 0 ? (
            <>
              <span className="mt-1.5 flex items-center gap-2">
                <span aria-hidden className="flex h-1 flex-1 gap-1">
                  {[0, 1, 2, 3].map((step) => (
                    <span key={step} className={cn("h-full flex-1 rounded-full", step <= STRENGTH_STEP[strength] ? STRENGTH_COLOR[strength] : "bg-muted")} />
                  ))}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{t(`password.strength.${strength}`)}</span>
              </span>
              <PasswordBreachAlert state={userBreach} />
            </>
          ) : null}
        >
          <PasswordInput value={userPassword} onChange={(event) => onUserPassword(event.target.value)} autoComplete="new-password" />
        </Field>
        <Field label={t("password.confirm")} hint={confirmPassword.length > 0 && confirmPassword !== userPassword ? t("password.mismatch") : t("password.confirmHint")}>
          <PasswordInput value={confirmPassword} onChange={(event) => onConfirmPassword(event.target.value)} autoComplete="new-password" />
        </Field>
        <Field label={t("tools.security.encrypt.ownerPassword")} hint={t("tools.security.encrypt.ownerPasswordHint")} note={ownerPassword.length > 0 ? <PasswordBreachAlert state={ownerBreach} /> : null}>
          <PasswordInput value={ownerPassword} onChange={(event) => onOwnerPassword(event.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <AlgorithmAndMetadata algorithm={algorithm} onAlgorithm={onAlgorithm} encryptMetadata={encryptMetadata} onEncryptMetadata={onEncryptMetadata} />
      {legacyCharset ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          {t("tools.security.encrypt.legacyCharset")}
        </p>
      ) : null}
      {tooLong ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          {t("tools.security.encrypt.passwordTooLong", { max: passwordByteLimit(algorithm) })}
        </p>
      ) : null}
      <PermissionsFieldset
        permissions={permissions}
        onPermissions={onPermissions}
        warning={sameOwner ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground/80">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            {t("tools.security.encrypt.ownerEqualsUser")}
          </p>
        ) : restricted && !ownerPassword ? (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground/80">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t("tools.security.encrypt.ownerPasswordWarning")}
          </p>
        ) : null}
      />
    </Section>
  );
}

export function GeneratedOwnerPassword({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div role="status" className="flex flex-col gap-1.5 px-4 py-2.5 text-sm">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <KeyRound className="size-4 shrink-0 text-warning" aria-hidden />
        {t("tools.security.encrypt.generatedOwner.title")}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-xs text-foreground">{value}</code>
        <IconButton icon={copied ? Check : Copy} label={t("tools.security.encrypt.generatedOwner.copy")} onClick={copy} />
      </div>
      <p className="text-xs text-muted-foreground">{t("tools.security.encrypt.generatedOwner.note")}</p>
    </div>
  );
}

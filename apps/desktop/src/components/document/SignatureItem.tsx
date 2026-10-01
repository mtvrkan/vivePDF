import { PenTool, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { signatureVerdict } from "@/shared/lib/signatureVerdict";
import type { SignatureInfo } from "@/types";

export function SignatureItem({ signature, locale }: { signature: SignatureInfo; locale: string }) {
  const { t } = useTranslation();
  const verdict = signatureVerdict(signature);
  const Icon = verdict === "trusted" ? ShieldCheck : verdict === "untrusted" ? PenTool : ShieldAlert;
  const warned = verdict === "untrusted" || verdict === "trustedWithChanges";
  return (
    <li className="border-b px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", verdict === "trusted" ? "text-success" : warned ? "text-warning" : "text-destructive")} aria-hidden />
        <span title={signature.signer} className="min-w-0 flex-1 truncate font-medium">{signature.signer}</span>
      </div>
      <dl className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
        <div className={verdict === "broken" || verdict === "modified" ? "text-destructive" : undefined}>
          {t(verdict === "broken" ? "tools.sign.verify.broken" : verdict === "modified" ? "tools.sign.verify.modified" : "tools.sign.verify.intact")}
        </div>
        {signature.certified ? <div>{t("tools.sign.verify.certified", { permission: t(`tools.sign.sign.permissions.${signature.permission ?? "forms"}`) })}</div> : null}
        <div>
          {t(signature.trusted ? "tools.sign.verify.trusted" : "tools.sign.verify.untrusted")}
          {signature.trusted ? ` · ${t(`tools.sign.verify.trustSource.${signature.trustSource}`)}` : ""}
        </div>
        {!signature.trusted && signature.trustProblem ? (
          <div className={signature.trustProblem === "revoked" ? "text-destructive" : undefined}>
            {t(`tools.sign.verify.trustProblems.${signature.trustProblem}`)}
          </div>
        ) : null}
        {verdict === "trustedWithChanges" ? <div className="text-warning">{t("tools.sign.verify.trustedWithChanges")}</div> : null}
        {signature.revoked !== null ? (
          <div className={signature.revoked ? "text-destructive" : undefined}>
            {t(signature.revoked ? "tools.sign.verify.revoked" : "tools.sign.verify.notRevoked")}
          </div>
        ) : null}
        {signature.signedAt ? <div>{new Date(signature.signedAt).toLocaleString(locale)}</div> : null}
        {signature.reason ? <div>{t("tools.sign.sign.reason")}: {signature.reason}</div> : null}
        <div>
          {t(`tools.sign.verify.coverageLevels.${signature.coverage}`, { defaultValue: signature.coverage })}
          {signature.modificationLevel ? ` · ${t(`tools.sign.verify.modificationLevels.${signature.modificationLevel}`, { defaultValue: signature.modificationLevel })}` : ""}
        </div>
      </dl>
    </li>
  );
}

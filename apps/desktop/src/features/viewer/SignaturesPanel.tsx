import { FileSignature, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { SignatureItem } from "@/components/document/SignatureItem";
import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useUiStore } from "@/shared/store/uiStore";
import { checkSignatures } from "./documentChecks";

export function SignaturesPanel({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const check = useDocumentMessagesStore((state) => state.signatures[documentId] ?? null);
  const recheck = () => {
    if (document) void checkSignatures({ id: document.id, path: document.path, password: document.password });
  };

  return (
    <aside aria-label={t("viewer.signatures.title")} className="flex h-full w-inspector flex-col border-e bg-card">
      <div className="flex h-row items-center gap-2 border-b px-3">
        <FileSignature className="size-4 text-primary" aria-hidden />
        <span className="flex-1 text-sm font-semibold">{t("viewer.signatures.title")}</span>
        <IconButton icon={RefreshCw} label={t("viewer.signatures.recheck")} onClick={recheck} disabled={!document || check?.state === "loading"} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {check === null || check.state === "loading" ? (
          <div className="p-3">
            <SkeletonCard lines={4} />
          </div>
        ) : null}
        {check?.state === "failed" ? <ErrorState title={t("viewer.signatures.failed")} message={t("viewer.signatures.failedHint")} onRetry={recheck} /> : null}
        {check?.state === "none" ? <EmptyState icon={FileSignature} title={t("viewer.signatures.none")} description={t("viewer.signatures.noneHint")} /> : null}
        {check?.state === "checked" ? (
          <ul>
            {check.signatures.map((signature) => (
              <SignatureItem key={signature.fieldName} signature={signature} locale={locale} />
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}

import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocumentInfoCard } from "@/components/document/DocumentInfoCard";
import { MetadataEditor } from "./MetadataEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { OpenDocument } from "@/types";
import { describeError } from "@/shared/lib/errorMessage";

export function Inspector({ document }: { document: OpenDocument }) {
  const { t } = useTranslation();
  const loadInfo = useDocumentStore((state) => state.loadInfo);

  return (
    <aside aria-label={t("viewer.inspector")} aria-busy={document.infoStatus === "loading" || undefined} className="h-full w-inspector overflow-auto border-s bg-card p-4">
      {document.infoStatus === "loading" || document.infoStatus === "idle" ? <SkeletonCard lines={6} numeral /> : null}
      {document.infoStatus === "error" && document.infoError ? (
        <ErrorState
          title={t("home.error.title")}
          message={describeError(t, document.infoError)}
          onRetry={() => void loadInfo(document.id)}
        />
      ) : null}
      {document.infoStatus === "success" && document.info ? (
        <>
          <DocumentInfoCard info={document.info} />
          <MetadataEditor document={document} />
        </>
      ) : null}
      {document.infoStatus === "success" && !document.info ? (
        <EmptyState icon={FileText} title={t("home.empty.title")} description={t("home.empty.description")} />
      ) : null}
    </aside>
  );
}

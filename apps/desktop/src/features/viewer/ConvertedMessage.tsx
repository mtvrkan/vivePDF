import { FileOutput, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { pathKey } from "@/shared/lib/paths";
import { fileNameOf } from "@/shared/rpc/files";
import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useConvertedStore } from "./convertedDocuments";
import { MessageRow } from "./MessageRow";
import { useDocumentSave } from "./useDocumentSave";

export function ConvertedMessage({ documentId }: { documentId: string }) {
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const original = useConvertedStore((state) => (path ? (state.originals[pathKey(path)] ?? null) : null));
  const dismissed = useDocumentMessagesStore((state) => state.dismissed[documentId]?.includes("converted") ?? false);
  if (!original || dismissed) return null;
  return <ConvertedRow documentId={documentId} original={original} />;
}

function ConvertedRow({ documentId, original }: { documentId: string; original: string }) {
  const { t } = useTranslation();
  const { save } = useDocumentSave(documentId);
  const dismiss = useDocumentMessagesStore((state) => state.dismiss);
  return (
    <MessageRow>
      <FileOutput className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={original}>
        {t("viewer.converted.message", { name: fileNameOf(original) })}
      </span>
      <Button size="sm" variant="ghost" onClick={() => void save()}>
        {t("viewer.converted.saveAsPdf")}
      </Button>
      <IconButton icon={X} label={t("viewer.messages.dismiss")} onClick={() => dismiss(documentId, "converted")} />
    </MessageRow>
  );
}

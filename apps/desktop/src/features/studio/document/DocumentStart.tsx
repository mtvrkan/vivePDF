import { useState } from "react";
import { FileText, FileUp, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { importAsDocument, pickImportFile } from "./documentFile";
import { readDocumentDraft, useDocumentStore } from "./documentStore";
import { buildStarter, DOCUMENT_STARTERS, type DocumentStarter } from "./starters";

export function DocumentStart({ language }: { language: string }) {
  const { t } = useTranslation();
  const open = useDocumentStore((state) => state.open);
  const [draft] = useState(readDocumentDraft);
  const [importing, setImporting] = useState(false);

  const start = (starter: DocumentStarter) => open(buildStarter(starter, t, language));

  const importFile = async () => {
    const path = await pickImportFile(t("studio.doc.importFilter"));
    if (!path) return;
    setImporting(true);
    try {
      open(await importAsDocument(path));
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="studio-documents">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="studio-documents" className="text-base font-semibold">
          {t("studio.doc.startTitle")}
        </h2>
        <Button size="sm" variant="ghost" icon={<FileUp className="size-4" aria-hidden />} loading={importing} onClick={() => void importFile()} className="ml-auto">
          {t("studio.doc.import")}
        </Button>
      </div>
      {draft ? (
        <div className="card glass-tinted flex flex-wrap items-center gap-4 rounded-xl p-4">
          <FileText className="size-8 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("studio.doc.continue")}</p>
            <p className="truncate text-sm text-muted-foreground">{draft.document.name || t("studio.doc.untitled")}</p>
          </div>
          <Button variant="primary" icon={<Play className="size-4" aria-hidden />} onClick={() => open(draft.document, draft.filePath)}>
            {t("studio.start.resume")}
          </Button>
        </div>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {DOCUMENT_STARTERS.map((starter) => (
          <li key={starter}>
            <button type="button" data-document-starter={starter} onClick={() => start(starter)} className="card glass-tinted flex h-full w-full flex-col items-start gap-2 rounded-xl p-4 text-left hover:ring-2 hover:ring-primary/40">
              <FileText className="size-6 text-primary" aria-hidden />
              <span className="text-sm font-medium">{t(`studio.doc.starters.names.${starter}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`studio.doc.starters.descriptions.${starter}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

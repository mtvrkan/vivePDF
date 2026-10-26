import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Segmented } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { useOperation } from "@/shared/hooks/useOperation";
import { sanitizeFileName } from "@/shared/lib/naming";
import { defaultOutputDirectory, joinPath } from "@/shared/lib/paths";
import { useDocumentStore } from "./documentStore";
import { documentText } from "./content";
import { DOCUMENT_EXPORT_FORMATS, EXPORT_EXTENSIONS, exportDocument, withExportExtension, type DocumentExportFormat } from "./exportDocument";

const IDLE_DESCRIPTIONS: Record<DocumentExportFormat, string> = { pdf: "studio.doc.export.idleDescription", word: "studio.doc.export.idleWord", markdown: "studio.doc.export.idleMarkdown" };

export function DocumentExportDialog({ open, onClose, language }: { open: boolean; onClose: () => void; language: string }) {
  const { t } = useTranslation();
  const name = useDocumentStore((state) => state.document?.name ?? "");
  const operation = useOperation(exportDocument);
  const [output, setOutput] = useState("");
  const [format, setFormat] = useState<DocumentExportFormat>("pdf");
  const extension = EXPORT_EXTENSIONS[format];

  useEffect(() => {
    if (!open) return;
    let live = true;
    void defaultOutputDirectory().then((directory) => {
      if (live) setOutput((current) => current || joinPath(directory, `${sanitizeFileName(name.trim()) || t("studio.doc.untitled")}.${extension}`));
    });
    return () => {
      live = false;
    };
  }, [open, name, t, extension]);

  const changeFormat = (next: DocumentExportFormat) => {
    setFormat(next);
    setOutput((current) => (current ? withExportExtension(current, next) : current));
  };

  const run = () => void operation.run({ output, language, text: documentText(t), format });
  const result = operation.result;
  const pageCount = result?.pageCount ?? null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("studio.doc.export.title")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" icon={<Download className="size-4" aria-hidden />} loading={operation.running} disabled={!output} onClick={run}>
            {t("studio.export.run")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={format} options={DOCUMENT_EXPORT_FORMATS} labelOf={(value) => t(`studio.export.formats.${value}`)} onChange={changeFormat} ariaLabel={t("studio.export.format")} />
        <OutputPathField value={output} onChange={setOutput} extension={extension} disabled={operation.running} />
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={pageCount === null ? undefined : String(pageCount)}
          caption={result ? (pageCount === null ? t(format === "word" ? "studio.doc.export.doneWord" : "studio.doc.export.doneMarkdown") : t("studio.export.done", { count: pageCount })) : undefined}
          outputs={result ? [result.output] : []}
          idleIcon={Download}
          idleTitle={t("studio.export.idleTitle")}
          idleDescription={t(IDLE_DESCRIPTIONS[format])}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        />
      </div>
    </Dialog>
  );
}

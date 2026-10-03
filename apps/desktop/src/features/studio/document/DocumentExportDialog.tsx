import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { useOperation } from "@/shared/hooks/useOperation";
import { sanitizeFileName } from "@/shared/lib/naming";
import { defaultOutputDirectory, joinPath } from "@/shared/lib/paths";
import { useDocumentStore } from "./documentStore";
import { exportDocument } from "./exportDocument";

export function DocumentExportDialog({ open, onClose, language }: { open: boolean; onClose: () => void; language: string }) {
  const { t } = useTranslation();
  const name = useDocumentStore((state) => state.document?.name ?? "");
  const operation = useOperation(exportDocument);
  const [output, setOutput] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    void defaultOutputDirectory().then((directory) => {
      if (live) setOutput((current) => current || joinPath(directory, `${sanitizeFileName(name.trim()) || t("studio.doc.untitled")}.pdf`));
    });
    return () => {
      live = false;
    };
  }, [open, name, t]);

  const run = () => void operation.run({ output, language, tocTitle: t("studio.doc.settings.tocTitleDefault") });
  const result = operation.result;
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
        <OutputPathField value={output} onChange={setOutput} extension="pdf" disabled={operation.running} />
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? String(result.pageCount) : undefined}
          caption={result ? t("studio.export.done", { count: result.pageCount }) : undefined}
          outputs={result ? [result.output] : []}
          idleIcon={Download}
          idleTitle={t("studio.export.idleTitle")}
          idleDescription={t("studio.doc.export.idleDescription")}
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

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Segmented } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { useOperation } from "@/shared/hooks/useOperation";
import type { RpcCallOptions } from "@/shared/rpc/client";
import { sanitizeFileName } from "@/shared/lib/naming";
import { defaultOutputDirectory, joinPath } from "@/shared/lib/paths";
import type { StudioDesign, StudioExportFormat } from "@/types/studio";
import { exportDesign, type ExportParams } from "../design/exportDesign";

const FORMATS: StudioExportFormat[] = ["pdf", "png", "jpg"];
const IMAGE_DPI = 200;

function withExtension(path: string, format: StudioExportFormat): string {
  return path.replace(/\.(pdf|png|jpe?g)$/i, "") + `.${format}`;
}

export function CvExportDialog({ open, onClose, design, language }: { open: boolean; onClose: () => void; design: StudioDesign | null; language: string }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<StudioExportFormat>("pdf");
  const [output, setOutput] = useState("");
  const operation = useOperation((params: ExportParams, options?: RpcCallOptions) => exportDesign(params, options, design ?? undefined));
  const name = design?.name ?? "";

  useEffect(() => {
    if (!open) return;
    let live = true;
    void defaultOutputDirectory().then((directory) => {
      if (live) setOutput((current) => current || joinPath(directory, `${sanitizeFileName(name.trim()) || t("studio.cv.untitled")}.pdf`));
    });
    return () => {
      live = false;
    };
  }, [open, name, t]);

  const changeFormat = (next: StudioExportFormat) => {
    setFormat(next);
    setOutput((current) => (current ? withExtension(current, next) : current));
  };

  const params = (): ExportParams => ({ output, format, dpi: format === "pdf" ? 150 : IMAGE_DPI, language, title: name, embed: format === "pdf" });
  const result = operation.result;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("studio.cv.export.title")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" icon={<Download className="size-4" aria-hidden />} loading={operation.running} disabled={!output || !design} onClick={() => void operation.run(params())}>
            {t("studio.cv.export.run")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={format} options={FORMATS} labelOf={(value) => t(`studio.export.formats.${value}`)} onChange={changeFormat} ariaLabel={t("studio.export.format")} />
        <OutputPathField value={output} onChange={setOutput} extension={format} disabled={operation.running} />
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? String(result.pageCount) : undefined}
          caption={result ? t("studio.export.done", { count: result.pageCount }) : undefined}
          outputs={result ? result.outputs : []}
          idleIcon={Download}
          idleTitle={t("studio.cv.export.idleTitle")}
          idleDescription={t("studio.cv.export.idleDescription")}
          onCancel={operation.cancel}
          onRetry={() => void operation.run(params())}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {result?.missingGlyphs ? <p className="text-sm text-warning">{t("studio.export.missingGlyphs", { glyphs: result.missingGlyphs })}</p> : null}
        </ResultPanel>
      </div>
    </Dialog>
  );
}

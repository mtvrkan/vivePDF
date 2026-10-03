import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Checkbox, Segmented } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { useOperation } from "@/shared/hooks/useOperation";
import { sanitizeFileName } from "@/shared/lib/naming";
import { defaultOutputDirectory, joinPath } from "@/shared/lib/paths";
import type { StudioExportFormat } from "@/types/studio";
import { exportDesign } from "./exportDesign";
import { useStudioStore } from "./studioStore";

const FORMATS: StudioExportFormat[] = ["pdf", "png", "jpg"];
const RESOLUTIONS = [72, 150, 300] as const;

function withExtension(path: string, format: StudioExportFormat): string {
  return path.replace(/\.(pdf|png|jpe?g)$/i, "") + `.${format}`;
}

export function ExportDialog({ open, onClose, language }: { open: boolean; onClose: () => void; language: string }) {
  const { t } = useTranslation();
  const name = useStudioStore((state) => state.design?.name ?? "");
  const operation = useOperation(exportDesign);
  const [format, setFormat] = useState<StudioExportFormat>("pdf");
  const [dpi, setDpi] = useState<number>(150);
  const [output, setOutput] = useState("");
  const [embed, setEmbed] = useState(true);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void defaultOutputDirectory().then((directory) => {
      if (live) setOutput((current) => current || joinPath(directory, `${sanitizeFileName(name.trim()) || t("studio.untitled")}.pdf`));
    });
    return () => {
      live = false;
    };
  }, [open, name, t]);

  const changeFormat = (next: StudioExportFormat) => {
    setFormat(next);
    setOutput((current) => (current ? withExtension(current, next) : current));
  };

  const result = operation.result;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("studio.export.title")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" icon={<Download className="size-4" aria-hidden />} loading={operation.running} disabled={!output} onClick={() => void operation.run({ output, format, dpi, language, title: name, embed })}>
            {t("studio.export.run")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={format} options={FORMATS} labelOf={(value) => t(`studio.export.formats.${value}`)} onChange={changeFormat} ariaLabel={t("studio.export.format")} />
        {format !== "pdf" ? (
          <Segmented size="sm" value={dpi} options={RESOLUTIONS} labelOf={(value) => t("studio.export.dpi", { dpi: value })} onChange={setDpi} ariaLabel={t("studio.export.resolution")} />
        ) : null}
        {format === "pdf" ? <Checkbox label={t("studio.export.embed")} hint={t("studio.export.embedHint")} checked={embed} onChange={setEmbed} /> : null}
        <OutputPathField value={output} onChange={setOutput} extension={format} disabled={operation.running} />
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? String(result.pageCount) : undefined}
          caption={result ? t("studio.export.done", { count: result.pageCount }) : undefined}
          outputs={result ? result.outputs : []}
          idleIcon={Download}
          idleTitle={t("studio.export.idleTitle")}
          idleDescription={t("studio.export.idleDescription")}
          onCancel={operation.cancel}
          onRetry={() => void operation.run({ output, format, dpi, language, title: name, embed })}
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

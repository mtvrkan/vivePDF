import { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Checkbox, Field, Segmented, TextInput } from "@/components/tool/form";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { useOperation } from "@/shared/hooks/useOperation";
import { sanitizeFileName } from "@/shared/lib/naming";
import { basenameOf, defaultOutputDirectory, joinPath } from "@/shared/lib/paths";
import type { StudioExportFormat } from "@/types/studio";
import { useMergeStore } from "../merge/mergeStore";
import { exportDesign, type ExportParams } from "./exportDesign";
import { useStudioStore } from "./studioStore";

const FORMATS: StudioExportFormat[] = ["pdf", "png", "jpg"];
const RESOLUTIONS = [72, 150, 300] as const;
const MODES = ["combined", "split"] as const;
const MAX_PATTERN = 120;

type Mode = (typeof MODES)[number];

function withExtension(path: string, format: StudioExportFormat): string {
  return path.replace(/\.(pdf|png|jpe?g)$/i, "") + `.${format}`;
}

export function ExportDialog({ open, onClose, language }: { open: boolean; onClose: () => void; language: string }) {
  const { t } = useTranslation();
  const name = useStudioStore((state) => state.design?.name ?? "");
  const dataPath = useMergeStore((state) => state.dataPath);
  const sheet = useMergeStore((state) => state.sheet);
  const table = useMergeStore((state) => state.table);
  const operation = useOperation(exportDesign);
  const [format, setFormat] = useState<StudioExportFormat>("pdf");
  const [dpi, setDpi] = useState<number>(150);
  const [output, setOutput] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [embed, setEmbed] = useState(true);
  const [useData, setUseData] = useState(true);
  const [mode, setMode] = useState<Mode>("combined");
  const [pattern, setPattern] = useState("{n}");
  const [signing, setSigning] = useState(false);
  const [certificatePath, setCertificatePath] = useState("");
  const [certificatePassword, setCertificatePassword] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    void defaultOutputDirectory().then((directory) => {
      if (!live) return;
      const base = sanitizeFileName(name.trim()) || t("studio.untitled");
      setOutput((current) => current || joinPath(directory, `${base}.pdf`));
      setOutputDir((current) => current || joinPath(directory, base));
    });
    return () => {
      live = false;
    };
  }, [open, name, t]);

  const merging = Boolean(dataPath && table && table.totalRows > 0 && useData);
  const split = merging && mode === "split";
  const pdf = format === "pdf";
  const signReady = !signing || (certificatePath && certificatePassword);
  const ready = (split ? Boolean(outputDir && pattern.trim()) : Boolean(output)) && signReady;

  const changeFormat = (next: StudioExportFormat) => {
    setFormat(next);
    setOutput((current) => (current ? withExtension(current, next) : current));
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    if (next === "split") changeFormat("pdf");
  };

  const pickCertificate = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PKCS#12", extensions: ["p12", "pfx"] }] });
    if (typeof selected === "string") setCertificatePath(selected);
  };

  const params = (): ExportParams => ({
    output,
    format,
    dpi,
    language,
    title: name,
    embed,
    dataPath: merging ? dataPath : null,
    sheet: merging ? sheet : null,
    split,
    outputDir,
    pattern: pattern.trim(),
    sign: pdf && signing ? { certificatePath, certificatePassword, reason: reason.trim(), location: location.trim() } : null,
  });

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
          <Button variant="primary" icon={<Download className="size-4" aria-hidden />} loading={operation.running} disabled={!ready} onClick={() => void operation.run(params())}>
            {merging ? t("studio.export.runRows", { count: table?.totalRows ?? 0 }) : t("studio.export.run")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {dataPath && table && table.totalRows > 0 ? (
          <section className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={dataPath}>
                {basenameOf(dataPath)}
              </span>
            </div>
            <Checkbox label={t("studio.export.useData", { count: table.totalRows })} hint={t("studio.export.useDataHint")} checked={useData} onChange={setUseData} />
            {useData ? <Segmented size="sm" value={mode} options={MODES} labelOf={(value) => t(`studio.export.modes.${value}`)} onChange={changeMode} ariaLabel={t("studio.export.mode")} /> : null}
          </section>
        ) : null}
        {split ? null : <Segmented value={format} options={FORMATS} labelOf={(value) => t(`studio.export.formats.${value}`)} onChange={changeFormat} ariaLabel={t("studio.export.format")} />}
        {!pdf ? <Segmented size="sm" value={dpi} options={RESOLUTIONS} labelOf={(value) => t("studio.export.dpi", { dpi: value })} onChange={setDpi} ariaLabel={t("studio.export.resolution")} /> : null}
        {pdf ? <Checkbox label={t("studio.export.embed")} hint={t("studio.export.embedHint")} checked={embed} onChange={setEmbed} /> : null}
        {split ? (
          <>
            <OutputDirField value={outputDir} onChange={setOutputDir} disabled={operation.running} />
            <Field label={t("studio.export.pattern")} hint={t("studio.export.patternHint", { columns: (table?.columns ?? []).map((column) => `{${column}}`).join(" ") })}>
              <TextInput value={pattern} maxLength={MAX_PATTERN} onChange={(event) => setPattern(event.target.value)} className="font-mono text-sm" data-testid="studio-export-pattern" />
            </Field>
          </>
        ) : (
          <OutputPathField value={output} onChange={setOutput} extension={format} disabled={operation.running} />
        )}
        {pdf ? (
          <section className="space-y-3">
            <Checkbox label={split ? t("studio.export.signEach") : t("studio.export.sign")} hint={t("studio.export.signHint")} checked={signing} onChange={setSigning} />
            {signing ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("tools.sign.sign.certificate")}>
                  <div className="flex gap-2">
                    <TextInput value={certificatePath ? basenameOf(certificatePath) : ""} readOnly className="font-mono text-sm" aria-label={t("tools.sign.sign.certificate")} />
                    <Button onClick={() => void pickCertificate()}>{t("tools.browse")}</Button>
                  </div>
                </Field>
                <Field label={t("tools.sign.sign.certificatePassword")}>
                  <TextInput type="password" value={certificatePassword} onChange={(event) => setCertificatePassword(event.target.value)} autoComplete="off" />
                </Field>
                <Field label={t("tools.sign.sign.reason")}>
                  <TextInput value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
                </Field>
                <Field label={t("tools.sign.sign.location")}>
                  <TextInput value={location} maxLength={200} onChange={(event) => setLocation(event.target.value)} />
                </Field>
              </div>
            ) : null}
          </section>
        ) : null}
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? String(split ? result.outputs.length : result.pageCount) : undefined}
          caption={result ? (split ? t("studio.export.doneFiles", { count: result.outputs.length }) : t("studio.export.done", { count: result.pageCount })) : undefined}
          outputs={result ? result.outputs : []}
          idleIcon={Download}
          idleTitle={t("studio.export.idleTitle")}
          idleDescription={merging ? t("studio.export.idleRows", { count: table?.totalRows ?? 0 }) : t("studio.export.idleDescription")}
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

import { useEffect, useId, useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Checkbox, Field, Segmented, SliderField, TextInput } from "@/components/tool/form";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { useOperation } from "@/shared/hooks/useOperation";
import { sanitizeFileName } from "@/shared/lib/naming";
import { basenameOf, defaultOutputDirectory, joinPath } from "@/shared/lib/paths";
import type { StudioExportFormat } from "@/types/studio";
import { useMergeStore } from "../merge/mergeStore";
import { hasSeeThroughBackground } from "../model/render";
import { exportDesign, type ExportParams } from "./exportDesign";
import { pictureNames, selectPages, type PageChoice } from "./exportPages";
import { DPI_PRESETS, MAX_DPI, MAX_QUALITY, MIN_DPI, MIN_QUALITY, readExportSettings, writeExportSettings } from "./exportSettings";
import { PageRangePicker } from "./PageRangePicker";
import { useStudioStore } from "./studioStore";

const FORMATS: StudioExportFormat[] = ["pdf", "png", "jpg"];
const RESOLUTION_CHOICES = [...DPI_PRESETS, "custom"] as const;
const MODES = ["combined", "split"] as const;
const MAX_PATTERN = 120;

type Mode = (typeof MODES)[number];
type ResolutionChoice = (typeof RESOLUTION_CHOICES)[number];

function withExtension(path: string, format: StudioExportFormat): string {
  return path.replace(/\.(pdf|png|jpe?g)$/i, "") + `.${format}`;
}

function presetOf(dpi: number): ResolutionChoice {
  return (DPI_PRESETS as readonly number[]).includes(dpi) ? (dpi as ResolutionChoice) : "custom";
}

function parseDpi(text: string): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= MIN_DPI && value <= MAX_DPI ? value : null;
}

export function ExportDialog({ open, onClose, language }: { open: boolean; onClose: () => void; language: string }) {
  const { t } = useTranslation();
  const dpiErrorId = useId();
  const name = useStudioStore((state) => state.design?.name ?? "");
  const designPages = useStudioStore((state) => (open ? state.design?.pages : undefined));
  const pageId = useStudioStore((state) => state.pageId);
  const dataPath = useMergeStore((state) => state.dataPath);
  const sheet = useMergeStore((state) => state.sheet);
  const table = useMergeStore((state) => state.table);
  const operation = useOperation(exportDesign);
  const [initial] = useState(readExportSettings);
  const [format, setFormat] = useState<StudioExportFormat>(initial.format);
  const [resolution, setResolution] = useState<ResolutionChoice>(presetOf(initial.dpi));
  const [dpiText, setDpiText] = useState(String(initial.dpi));
  const [quality, setQuality] = useState(initial.quality);
  const [transparent, setTransparent] = useState(initial.transparent);
  const [output, setOutput] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [embed, setEmbed] = useState(initial.embed);
  const [useData, setUseData] = useState(true);
  const [mode, setMode] = useState<Mode>("combined");
  const [pattern, setPattern] = useState("{n}");
  const [pageChoice, setPageChoice] = useState<PageChoice>("all");
  const [customPages, setCustomPages] = useState("");
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
      setOutput((current) => current || joinPath(directory, `${base}.${initial.format}`));
      setOutputDir((current) => current || joinPath(directory, base));
    });
    return () => {
      live = false;
    };
  }, [open, name, t, initial.format]);

  const pageCount = designPages?.length ?? 0;
  const currentIndex = Math.max(0, designPages?.findIndex((page) => page.id === pageId) ?? 0);
  const selection = useMemo(() => selectPages(pageChoice, customPages, currentIndex, pageCount), [pageChoice, customPages, currentIndex, pageCount]);
  const chosen = selection.ok ? selection.pages : [];
  const merging = Boolean(dataPath && table && table.totalRows > 0 && useData);
  const split = merging && mode === "split";
  const pdf = format === "pdf";
  const picture = !pdf && !split;
  const dpi = resolution === "custom" ? parseDpi(dpiText) : resolution;
  const signReady = !signing || (certificatePath && certificatePassword);
  const ready = (split ? Boolean(outputDir && pattern.trim()) : Boolean(output)) && signReady && selection.ok && (pdf || dpi !== null);
  const seeThrough = designPages ? chosen.some((page) => designPages[page - 1] && hasSeeThroughBackground(designPages[page - 1])) : false;
  const names = picture && output && selection.ok ? pictureNames(output, format, chosen, merging ? (table?.totalRows ?? 1) : 1) : [];

  const changeFormat = (next: StudioExportFormat) => {
    setFormat(next);
    setOutput((current) => (current ? withExtension(current, next) : current));
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    if (next === "split") changeFormat("pdf");
  };

  const changeResolution = (next: ResolutionChoice) => {
    setResolution(next);
    if (next !== "custom") setDpiText(String(next));
  };

  const pickCertificate = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PKCS#12", extensions: ["p12", "pfx"] }] });
    if (typeof selected === "string") setCertificatePath(selected);
  };

  const params = (): ExportParams => ({
    output,
    format,
    dpi: dpi ?? initial.dpi,
    quality,
    transparent: format === "png" && transparent,
    pages: chosen,
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

  const run = () => {
    writeExportSettings({ format, dpi: dpi ?? initial.dpi, quality, transparent, embed });
    void operation.run(params());
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
          <Button variant="primary" icon={<Download className="size-4" aria-hidden />} loading={operation.running} disabled={!ready} onClick={run}>
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
        {pageCount > 1 ? (
          <PageRangePicker choice={pageChoice} custom={customPages} onChoice={setPageChoice} onCustom={setCustomPages} pageCount={pageCount} currentIndex={currentIndex} selection={selection} disabled={operation.running} />
        ) : null}
        {picture ? (
          <section className="space-y-3">
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground/80">{t("studio.export.resolution")}</span>
              <Segmented
                size="sm"
                value={resolution}
                options={RESOLUTION_CHOICES}
                labelOf={(value) => (value === "custom" ? t("studio.export.dpiCustom") : t("studio.export.dpi", { dpi: value }))}
                onChange={changeResolution}
                ariaLabel={t("studio.export.resolution")}
              />
              {resolution === "custom" ? (
                <div className="flex items-center gap-2">
                  <TextInput
                    type="number"
                    inputMode="numeric"
                    min={MIN_DPI}
                    max={MAX_DPI}
                    step={1}
                    value={dpiText}
                    onChange={(event) => setDpiText(event.target.value)}
                    aria-label={t("studio.export.dpiCustom")}
                    aria-invalid={dpi === null ? true : undefined}
                    aria-describedby={dpiErrorId}
                    className="w-28 font-mono text-sm"
                    data-testid="studio-export-dpi"
                  />
                  <span className="text-sm text-muted-foreground">dpi</span>
                </div>
              ) : null}
              <p id={dpiErrorId} className={dpi === null ? "text-xs text-destructive" : "text-xs text-muted-foreground"} aria-live="polite">
                {dpi === null ? t("studio.export.dpiError", { min: MIN_DPI, max: MAX_DPI }) : t("studio.export.dpiHint")}
              </p>
            </div>
            {format === "jpg" ? (
              <SliderField label={t("studio.export.quality")} hint={t("studio.export.qualityHint")} value={quality} min={MIN_QUALITY} max={MAX_QUALITY} onChange={setQuality} format={(value) => `${value}`} />
            ) : null}
            {format === "png" ? (
              <Checkbox
                label={t("studio.export.transparent")}
                hint={seeThrough || !transparent ? t("studio.export.transparentHint") : t("studio.export.transparentNone")}
                checked={transparent}
                onChange={setTransparent}
              />
            ) : null}
            {names.length ? (
              <p className="text-xs text-muted-foreground" data-testid="studio-export-files">
                {names.length === 1 ? t("studio.export.oneFile", { name: names[0] }) : t("studio.export.eachPage", { count: names.length, first: names[0], last: names[names.length - 1] })}
              </p>
            ) : null}
          </section>
        ) : null}
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
          numeral={result ? String(split || picture ? result.outputs.length : result.pageCount) : undefined}
          caption={result ? (split || picture ? t("studio.export.doneFiles", { count: result.outputs.length }) : t("studio.export.done", { count: result.pageCount })) : undefined}
          outputs={result ? result.outputs : []}
          idleIcon={Download}
          idleTitle={t("studio.export.idleTitle")}
          idleDescription={merging ? t("studio.export.idleRows", { count: table?.totalRows ?? 0 }) : pdf ? t("studio.export.idleDescription") : t("studio.export.idlePictures")}
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

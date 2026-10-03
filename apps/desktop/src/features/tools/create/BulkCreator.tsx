import { useEffect, useRef, useState, type ReactNode } from "react";
import { Award, FileSpreadsheet, ImagePlus, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { IconButton } from "@/components/shared/IconButton";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { Field, OptionCards, Section, Segmented, SelectInput, TextArea, TextInput } from "@/components/tool/form";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { describeError } from "@/shared/lib/errorMessage";
import { outputFileName } from "@/shared/lib/naming";
import { basenameOf, joinPath, outputDirectoryFor, stemOf, suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { createBulk, previewFormData } from "@/shared/rpc/operations";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import type { BulkKind, BulkSigner, CreateFont, DataPreviewResult } from "@/types";
import { BULK_DATA_EXTENSIONS, BULK_KINDS, CREATE_FONTS, DEFAULT_ACCENT, LOGO_EXTENSIONS, MAX_SIGNERS, bulkPresetTexts, placeholderOf, withPlaceholder, type BulkTextField, type BulkTexts } from "./createDocument";
import { Group } from "./Group";

type OutputMode = "combined" | "separate";
const OUTPUT_MODES: OutputMode[] = ["combined", "separate"];

export function BulkCreator({ modeSwitch }: { modeSwitch: ReactNode }) {
  const { t } = useTranslation();
  const operation = useOperation(createBulk);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<DataPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<BulkKind>("certificate");
  const [texts, setTexts] = useState<BulkTexts>(() => bulkPresetTexts("certificate", t));
  const [signers, setSigners] = useState<BulkSigner[]>([{ name: "", role: "" }]);
  const [font, setFont] = useState<CreateFont>("serif");
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [logo, setLogo] = useState<string | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>("combined");
  const [output, setOutput] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [pattern, setPattern] = useState("{n}");
  const focused = useRef<BulkTextField>("recipient");

  useEffect(() => {
    if (!dataPath) return;
    let live = true;
    setPreview(null);
    setPreviewError(null);
    previewFormData({ path: dataPath, sheet, limit: 3 })
      .then((result) => {
        if (!live) return;
        setPreview(result);
        const first = result.columns[0];
        if (first) {
          setTexts((current) => (current.recipient.trim() ? current : { ...current, recipient: placeholderOf(first) }));
          setPattern((current) => (current === "{n}" ? placeholderOf(first) : current));
        }
      })
      .catch((error: unknown) => {
        if (live) setPreviewError(describeError(t, toRpcError(error)));
      });
    return () => {
      live = false;
    };
  }, [dataPath, sheet, t]);

  useEffect(() => {
    if (!dataPath) return;
    const suffix = t(`tools.create.bulk.kinds.${kind}.suffix`);
    setOutput(suggestOutputPath(dataPath, suffix));
    setOutputDir(joinPath(outputDirectoryFor(dataPath), outputFileName(stemOf(dataPath), suffix)));
  }, [dataPath, kind, t]);

  useEffect(() => {
    const store = useDropTargetStore.getState();
    store.setHandler((paths) => {
      const dropped = paths.find((path) => BULK_DATA_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? ""));
      if (!dropped) return;
      setDataPath(dropped);
      setSheet(undefined);
    });
    return () => store.setHandler(null);
  }, []);

  const chooseData = (path: string) => {
    setDataPath(path);
    setSheet(undefined);
  };

  const chooseKind = (next: BulkKind) => {
    setKind(next);
    setTexts((current) => ({ ...bulkPresetTexts(next, t), recipient: current.recipient }));
    if (next === "badge") setOutputMode("combined");
  };

  const pickData = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.create.bulk.dataFiles"), extensions: BULK_DATA_EXTENSIONS }] });
    if (typeof selected === "string") chooseData(selected);
  };

  const pickLogo = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.create.logoFiles"), extensions: LOGO_EXTENSIONS }] });
    if (typeof selected === "string") setLogo(selected);
  };

  const setText = (field: BulkTextField, value: string) => setTexts((current) => ({ ...current, [field]: value }));
  const insertColumn = (column: string) => setText(focused.current, withPlaceholder(texts[focused.current], column));
  const separate = outputMode === "separate" && kind !== "badge";
  const ready = dataPath !== null && preview !== null && preview.totalRows > 0 && (separate ? outputDir.length > 0 : output.length > 0);

  const run = () => {
    if (!dataPath || !ready) return;
    void operation.run({
      dataPath,
      sheet,
      kind,
      ...texts,
      signers: kind === "badge" ? [] : signers.filter((signer) => signer.name.trim() || signer.role.trim()),
      font,
      accent,
      logo: logo ?? undefined,
      split: separate,
      ...(separate ? { outputDir, pattern } : { output }),
    });
  };

  const textInput = (field: BulkTextField, multiline = false) => {
    const label = t(`tools.create.bulk.fields.${field}`);
    const example = field === "recipient" ? t("tools.create.bulk.recipientExample") : t(`tools.create.bulk.kinds.${kind}.examples.${field}`);
    const common = { value: texts[field], placeholder: example, onFocus: () => (focused.current = field), "aria-label": label };
    return (
      <Field label={label}>
        {multiline ? (
          <TextArea rows={3} maxLength={field === "body" ? 2000 : 500} {...common} onChange={(event) => setText(field, event.target.value)} />
        ) : (
          <TextInput maxLength={300} {...common} onChange={(event) => setText(field, event.target.value)} />
        )}
      </Field>
    );
  };

  const result = operation.result;

  return (
    <ToolLayout
      title={t("tools.create.bulk.title")}
      icon={Award}
      description={t("tools.create.bulk.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t("tools.create.bulk.run", { count: preview?.totalRows ?? 0 })}
        </Button>
      }
      form={
        <fieldset disabled={operation.running} className="contents">
          <Section>{modeSwitch}</Section>
          <Section title={t("tools.create.bulk.data")}>
            {dataPath ? (
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={dataPath}>
                  {basenameOf(dataPath)}
                </span>
                {preview ? <span className="shrink-0 text-xs text-muted-foreground">{t("tools.create.bulk.rows", { count: preview.totalRows })}</span> : null}
                <Button size="sm" variant="ghost" onClick={() => void pickData()}>
                  {t("tools.create.change")}
                </Button>
              </div>
            ) : (
              <FileDropArea title={t("tools.create.bulk.pickTitle")} description={t("tools.create.bulk.pickDescription")} icon={FileSpreadsheet} onPick={() => void pickData()} />
            )}
            {dataPath && !preview && !previewError ? (
              <div role="status" aria-label={t("tools.create.bulk.reading")} className="flex gap-2">
                <div className="h-6 w-24 animate-pulse rounded-full bg-secondary/70" />
                <div className="h-6 w-20 animate-pulse rounded-full bg-secondary/70" />
              </div>
            ) : null}
            {previewError ? (
              <p role="alert" className="text-xs text-destructive">
                {previewError}
              </p>
            ) : null}
            {preview && preview.sheets.length > 1 ? (
              <Field label={t("tools.create.bulk.sheet")}>
                <SelectInput value={sheet ?? preview.sheets[0]} onChange={(event) => setSheet(event.target.value)} aria-label={t("tools.create.bulk.sheet")}>
                  {preview.sheets.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : null}
            {preview && preview.totalRows === 0 ? <p className="text-xs text-warning">{t("tools.create.bulk.noRows")}</p> : null}
            {preview && preview.columns.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t("tools.create.bulk.columnsHint")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.columns.map((column) => (
                    <button
                      key={column}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertColumn(column)}
                      className="glass-chip rounded-full px-2.5 py-1 font-mono text-xs text-primary outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {placeholderOf(column)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </Section>
          <Section title={t("tools.create.bulk.kind")}>
            <OptionCards
              value={kind}
              onChange={chooseKind}
              ariaLabel={t("tools.create.bulk.kind")}
              options={BULK_KINDS.map((value) => ({ value, title: t(`tools.create.bulk.kinds.${value}.title`), description: t(`tools.create.bulk.kinds.${value}.description`) }))}
            />
          </Section>
          <Section title={t("tools.create.bulk.texts")}>
            {textInput("heading")}
            {textInput("recipient")}
            {textInput("body", true)}
            {textInput("details", true)}
            {kind !== "badge" ? (
              <Group label={t("tools.create.bulk.signers")}>
                <div className="space-y-2">
                  {signers.map((signer, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <TextInput
                        value={signer.name}
                        maxLength={120}
                        placeholder={t("tools.create.bulk.signerName")}
                        aria-label={`${t("tools.create.bulk.signerName")} ${index + 1}`}
                        onChange={(event) => setSigners((current) => current.map((entry, position) => (position === index ? { ...entry, name: event.target.value } : entry)))}
                      />
                      <TextInput
                        value={signer.role}
                        maxLength={120}
                        placeholder={t("tools.create.bulk.signerRole")}
                        aria-label={`${t("tools.create.bulk.signerRole")} ${index + 1}`}
                        onChange={(event) => setSigners((current) => current.map((entry, position) => (position === index ? { ...entry, role: event.target.value } : entry)))}
                      />
                      <IconButton icon={X} label={t("tools.create.bulk.removeSigner")} disabled={signers.length === 1} onClick={() => setSigners((current) => current.filter((_, position) => position !== index))} />
                    </div>
                  ))}
                  {signers.length < MAX_SIGNERS ? (
                    <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} onClick={() => setSigners((current) => [...current, { name: "", role: "" }])}>
                      {t("tools.create.bulk.addSigner")}
                    </Button>
                  ) : null}
                </div>
              </Group>
            ) : null}
          </Section>
          <Section title={t("tools.create.look")}>
            <Field label={t("tools.create.font")}>
              <Segmented value={font} options={CREATE_FONTS} labelOf={(value) => t(`tools.create.fonts.${value}`)} onChange={setFont} ariaLabel={t("tools.create.font")} />
            </Field>
            <Group label={t("tools.create.accent")}>
              <ColorSwatch value={accent} onChange={setAccent} label={t("tools.create.accent")} customLabel={t("tools.create.customColor")} />
            </Group>
            <Group label={t("tools.create.logo")}>
              {logo ? (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <ImagePlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={logo}>
                    {basenameOf(logo)}
                  </span>
                  <IconButton icon={X} label={t("tools.create.removeLogo")} onClick={() => setLogo(null)} />
                </div>
              ) : (
                <Button size="sm" icon={<ImagePlus className="size-4" aria-hidden />} onClick={() => void pickLogo()}>
                  {t("tools.create.pickLogo")}
                </Button>
              )}
            </Group>
          </Section>
          <Section>
            {kind !== "badge" ? (
              <Field label={t("tools.create.bulk.outputMode")}>
                <Segmented value={outputMode} options={OUTPUT_MODES} labelOf={(value) => t(`tools.create.bulk.outputModes.${value}`)} onChange={setOutputMode} ariaLabel={t("tools.create.bulk.outputMode")} />
              </Field>
            ) : null}
            {separate ? (
              <>
                <OutputDirField value={outputDir} onChange={setOutputDir} disabled={operation.running} />
                <Field label={t("tools.create.bulk.pattern")} hint={t("tools.create.bulk.patternHint")}>
                  <TextInput value={pattern} maxLength={120} onChange={(event) => setPattern(event.target.value)} className="font-mono" aria-label={t("tools.create.bulk.pattern")} />
                </Field>
              </>
            ) : (
              <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
            )}
          </Section>
        </fieldset>
      }
      result={
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? String(result.count) : undefined}
          caption={result ? t("tools.create.bulk.resultCaption", { count: result.count, pages: result.pageCount }) : undefined}
          outputs={result ? result.outputs : []}
          idleIcon={Award}
          idleTitle={t("tools.create.bulk.idle.title")}
          idleDescription={t("tools.create.bulk.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        />
      }
    />
  );
}

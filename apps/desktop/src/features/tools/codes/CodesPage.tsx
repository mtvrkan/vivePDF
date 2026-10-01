import { useEffect, useState } from "react";
import { Copy, Download, QrCode, ScanBarcode, TriangleAlert } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Field, Fieldset, PresetRow, Section, SelectInput, Segmented, SwitchField, TextArea, TextInput } from "@/components/tool/form";
import { PositionGrid } from "@/components/tool/PositionGrid";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { formatNumber } from "@/shared/lib/format";
import { describeError } from "@/shared/lib/errorMessage";
import { suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError, type RpcCallOptions } from "@/shared/rpc/client";
import { addQrCodes, exportCodesCsv, readCodes } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { CODE_FORMATS, SQUARE_CODE_FORMATS, type CodeFormat, type CodesReadParams, type QrAddResult, type QrPosition } from "@/types";
import { withinRange } from "@/shared/lib/numberRange";
import { HEIGHT_MM, levelFor, levelsFor, MARGIN_MM, MM_TO_PT, SIZE_MM, type ErrorLevel } from "./codeOptions";

type Tab = "add" | "read";
type ValueSource = "same" | "list";
const VALUE_SOURCES: ValueSource[] = ["same", "list"];
const TABS: Tab[] = ["add", "read"];
const COMMON_FORMATS: CodeFormat[] = ["qr", "dataMatrix", "code128", "ean13"];

const scanCodes = (params: CodesReadParams & { overwrite?: boolean }, options: RpcCallOptions) => readCodes(params, options);

export function CodesPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const sourceState = useSourceDocument();
  const operation = useOperation(addQrCodes);
  const reading = useOperation(scanCodes);
  const [tab] = useTabParam<Tab>(TABS, "add");
  const [output, setOutput] = useState("");
  const [text, setText] = useState("");
  const [valueSource, setValueSource] = useState<ValueSource>("same");
  const [valueList, setValueList] = useState("");
  const [thorough, setThorough] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pages, setPages] = useState("");
  const [sizeMm, setSizeMm] = useState(25);
  const [marginMm, setMarginMm] = useState(8);
  const [position, setPosition] = useState<QrPosition>("bottom-right");
  const [level, setLevel] = useState<ErrorLevel>("M");
  const [codeFormat, setCodeFormat] = useState<CodeFormat>("qr");
  const [codeHeightMm, setCodeHeightMm] = useState(17);
  const [codeColor, setCodeColor] = useState("#000000");
  const [codeCaption, setCodeCaption] = useState(false);
  const source = sourceState.source;
  const codes = reading.result?.codes ?? null;
  const scanning = reading.running;
  const cancelReading = reading.cancel;
  const resetReading = reading.reset;

  useEffect(() => {
    if (source) setOutput(suggestOutputPath(source.path, t("tools.codes.add.suffix")));
  }, [source, t]);

  useEffect(() => {
    cancelReading();
    resetReading();
  }, [source, cancelReading, resetReading]);

  const scan = () => {
    if (!source) return;
    void reading.run({ path: source.path, password: source.password ?? undefined, pages: pages.trim() || undefined, thorough }, { quiet: true });
  };

  const chooseFormat = (next: CodeFormat) => {
    setCodeFormat(next);
    setLevel((current) => levelFor(next, current));
  };

  const copyAll = async () => {
    if (!codes || codes.length === 0) return;
    try {
      await navigator.clipboard.writeText(codes.map((code) => code.text).join("\n"));
      toast("success", t("tools.codes.read.copied", { count: codes.length }));
    } catch {
      toast("error", t("tools.codes.read.copyFailed"));
    }
  };

  const values = valueList.split(/\r?\n/).map((line) => line.trim());
  const hasPayload = valueSource === "same" ? text.trim().length > 0 : values.some((line) => line.length > 0);
  const square = SQUARE_CODE_FORMATS.includes(codeFormat);
  const levels = levelsFor(codeFormat);
  const sizeValid = withinRange(sizeMm, SIZE_MM);
  const marginValid = withinRange(marginMm, MARGIN_MM);
  const heightValid = square || withinRange(codeHeightMm, HEIGHT_MM);
  const ready = !!source?.info && (tab === "read" || (output.length > 0 && hasPayload && sizeValid && marginValid && heightValid));

  const exportCsv = async () => {
    if (!source || !codes || codes.length === 0) return;
    const selected = await saveDialog({
      defaultPath: suggestOutputPath(source.path, t("tools.codes.read.suffix"), "csv"),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!selected) return;
    setExporting(true);
    try {
      const result = await exportCodesCsv({ codes, output: selected, overwrite: true });
      toast("success", t("tools.codes.read.exported", { count: result.count }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setExporting(false);
    }
  };

  const run = () => {
    if (!source || !ready) return;
    if (tab === "read") {
      scan();
      return;
    }
    void operation.run({
      path: source.path,
      password: source.password ?? undefined,
      output,
      pages: pages.trim() || undefined,
      text: valueSource === "same" ? text.trim() : "",
      values: valueSource === "list" ? values : undefined,
      size: sizeMm * MM_TO_PT,
      position,
      margin: marginMm * MM_TO_PT,
      errorLevel: levels.length > 0 ? level : undefined,
      format: codeFormat,
      height: square ? undefined : codeHeightMm * MM_TO_PT,
      color: codeColor,
      caption: codeCaption,
    });
  };

  const resetOperation = operation.reset;

  useEffect(() => {
    resetOperation();
  }, [tab, resetOperation]);

  return (
    <ToolLayout
      title={t(`tools.codes.${tab}.title`)}
      icon={QrCode}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running || scanning} disabled={!ready}>
          {t(`tools.codes.${tab}.run`)}
        </Button>
      }
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running || scanning} />

          {tab === "add" ? (
            <>
              <Section title={t("tools.codes.add.title")}>
                <Segmented
                  value={valueSource}
                  options={VALUE_SOURCES}
                  labelOf={(value) => t(`tools.codes.add.sources.${value}`)}
                  onChange={setValueSource}
                  ariaLabel={t("tools.codes.add.text")}
                  size="sm"
                />
                {valueSource === "same" ? (
                  <Field label={t("tools.codes.add.text")} hint={t("tools.codes.add.textHint")}>
                    <TextInput value={text} onChange={(event) => setText(event.target.value)} placeholder={t("tools.codes.add.textPlaceholder")} className="font-mono" />
                  </Field>
                ) : (
                  <Field label={t("tools.codes.add.values")} hint={t("tools.codes.add.valuesHint")}>
                    <TextArea value={valueList} onChange={(event) => setValueList(event.target.value)} rows={6} placeholder={t("tools.codes.add.valuesPlaceholder")} className="font-mono" />
                  </Field>
                )}
                <Fieldset title={t("tools.codes.add.symbology")}>
                  <PresetRow label={t("tools.codes.add.common")}>
                    <Segmented
                      value={codeFormat}
                      options={COMMON_FORMATS}
                      labelOf={(value) => t(`tools.codes.add.formats.${value}`)}
                      onChange={chooseFormat}
                      ariaLabel={t("tools.codes.add.common")}
                      size="sm"
                      className="flex-wrap"
                    />
                  </PresetRow>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("tools.codes.add.format")} hint={t("tools.codes.add.formatHint")}>
                      <SelectInput value={codeFormat} aria-label={t("tools.codes.add.format")} onChange={(event) => chooseFormat(event.target.value as CodeFormat)}>
                        {CODE_FORMATS.map((value) => (
                          <option key={value} value={value}>
                            {t(`tools.codes.add.formats.${value}`)}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    {levels.length > 0 ? (
                      <Field label={t("tools.codes.add.level")} hint={t("tools.codes.add.levelHint")}>
                        <SelectInput value={level} aria-label={t("tools.codes.add.level")} onChange={(event) => setLevel(event.target.value as ErrorLevel)}>
                          {levels.map((value) => (
                            <option key={value} value={value}>
                              {t(`tools.codes.add.levels.${value}`)}
                            </option>
                          ))}
                        </SelectInput>
                      </Field>
                    ) : null}
                    {square ? null : (
                      <Field label={t("tools.codes.add.height")} hint={heightValid ? undefined : t("tools.outOfRange", HEIGHT_MM)}>
                        <TextInput type="number" min={HEIGHT_MM.min} max={HEIGHT_MM.max} value={codeHeightMm} onChange={(event) => setCodeHeightMm(event.target.valueAsNumber)} aria-invalid={!heightValid || undefined} className="font-mono" />
                      </Field>
                    )}
                  </div>
                </Fieldset>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t("tools.codes.add.size")} hint={sizeValid ? undefined : t("tools.outOfRange", SIZE_MM)}>
                    <TextInput type="number" min={SIZE_MM.min} max={SIZE_MM.max} value={sizeMm} onChange={(event) => setSizeMm(event.target.valueAsNumber)} aria-invalid={!sizeValid || undefined} className="font-mono" />
                  </Field>
                  <Field label={t("tools.codes.add.margin")} hint={marginValid ? undefined : t("tools.outOfRange", MARGIN_MM)}>
                    <TextInput type="number" min={MARGIN_MM.min} max={MARGIN_MM.max} value={marginMm} onChange={(event) => setMarginMm(event.target.valueAsNumber)} aria-invalid={!marginValid || undefined} className="font-mono" />
                  </Field>
                  <Field label={t("tools.color")}>
                    <ColorSwatch value={codeColor} onChange={setCodeColor} label={t("tools.color")} customLabel={t("colorPicker.custom")} />
                  </Field>
                </div>
                <div className="flex flex-wrap items-start gap-5">
                  <PositionGrid value={position} onChange={(value) => setPosition(value as QrPosition)} label={t("tools.position")} />
                  <div className="min-w-56 max-w-md flex-1 space-y-3.5">
                    <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
                      <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
                    </Field>
                    <SwitchField label={t("tools.codes.add.caption")} hint={t("tools.codes.add.captionHint")} checked={codeCaption} onChange={setCodeCaption} />
                  </div>
                </div>
              </Section>
              <Section>
                <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
              </Section>
            </>
          ) : (
            <Section title={t("tools.codes.read.title")}>
              <p className="text-sm text-muted-foreground">{t("tools.codes.read.hint")}</p>
              <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
                <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="w-64 font-mono" />
              </Field>
              <SwitchField label={t("tools.codes.read.thorough")} hint={t("tools.codes.read.thoroughHint")} checked={thorough} onChange={setThorough} disabled={scanning} />
              {codes && codes.length === 0 ? <p className="text-sm text-muted-foreground">{t("tools.codes.read.none")}</p> : null}
              {codes && codes.length > 0 ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t("tools.codes.read.found", { count: codes.length })}</span>
                    <Button size="sm" icon={<Copy className="size-4" aria-hidden />} onClick={() => void copyAll()}>
                      {t("tools.codes.read.copyAll")}
                    </Button>
                    <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => void exportCsv()} loading={exporting} disabled={exporting}>
                      {t("tools.codes.read.exportCsv")}
                    </Button>
                  </div>
                  <ul className="rounded-lg border text-sm">
                    {codes.map((code, index) => (
                      <li key={`${code.page}-${index}`} className="flex items-center gap-3 border-b px-3 py-1.5 last:border-b-0">
                        <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{t("viewer.comments.pageShort", { page: code.page })}</span>
                        <span title={code.format} className="w-24 shrink-0 truncate text-xs text-muted-foreground">{code.format}</span>
                        <span className="min-w-0 flex-1 truncate font-mono" title={code.text}>
                          {code.text}
                        </span>
                        <IconButton icon={Copy} label={t("tools.codes.read.copy")} onClick={() => void navigator.clipboard.writeText(code.text)} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Section>
          )}
        </>
      }
      result={
        tab === "add" ? (
          <ResultPanel
            sourcePath={source?.path}
          sourcePassword={source?.password ?? undefined}
            status={operation.status}
            progress={operation.progress}
            error={operation.error}
            numeral={operation.result ? formatNumber(operation.result.stamped, locale) : undefined}
            caption={operation.result ? t("tools.codes.add.stamped") : undefined}
            outputs={operation.result ? [operation.result.output] : []}
            idleIcon={QrCode}
            idleTitle={t("tools.codes.idle.title")}
            idleDescription={t("tools.codes.idle.description")}
            onCancel={operation.cancel}
            onRetry={run}
            overwritePrompt={operation.overwritePrompt}
            onConfirmOverwrite={operation.confirmOverwrite}
            onDismissOverwrite={operation.dismissOverwrite}
          >
            {operation.result ? <AddNotes result={operation.result} /> : null}
          </ResultPanel>
        ) : (
          <ResultPanel
            status={reading.status}
            progress={reading.progress}
            error={reading.error}
            numeral={codes ? formatNumber(codes.length, locale) : undefined}
            caption={codes ? t("tools.codes.read.caption") : undefined}
            outputs={[]}
            idleIcon={ScanBarcode}
            idleTitle={t("tools.codes.idle.title")}
            idleDescription={t("tools.codes.read.idle")}
            onCancel={reading.cancel}
            onRetry={run}
            overwritePrompt={null}
            onConfirmOverwrite={() => undefined}
            onDismissOverwrite={() => undefined}
          />
        )
      }
    />
  );
}

function AddNotes({ result }: { result: QrAddResult }) {
  const { t } = useTranslation();
  const notes = [
    result.verified ? null : t("tools.codes.add.unverified"),
    result.unused ? t("tools.codes.add.unused", { count: result.unused }) : null,
    result.missingGlyphs ? t("tools.codes.add.missingGlyphs", { characters: Array.from(result.missingGlyphs).join(" ") }) : null,
  ].filter((note): note is string => note !== null);
  if (notes.length === 0) return null;
  return (
    <ul role="status" className="space-y-1.5 px-4 py-2.5 text-sm text-foreground/80">
      {notes.map((note) => (
        <li key={note} className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {note}
        </li>
      ))}
    </ul>
  );
}

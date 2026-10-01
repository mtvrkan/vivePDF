import { useEffect, useState } from "react";
import { ScanText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox, Field, OptionCards, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { analyzePages, rangesOf, type AnalyzeResult } from "@/shared/rpc/analyze";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf, dirnameOf, joinPath, stemOf, suggestOutputPath } from "@/shared/lib/paths";
import { runOcr } from "@/shared/rpc/operations";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import { useUiStore } from "@/shared/store/uiStore";
import { currentLocale } from "@/app/i18n";
import { defaultOcrLanguages, tesseractLanguageName } from "@/app/locales";
import { pagesInRanges } from "@/shared/lib/pageRanges";
import { TessdataManager } from "@/features/settings/TessdataManager";
import type { OcrParams } from "@/types";

type TextFormat = "txt" | "docx";

function textOutputFor(output: string, format: TextFormat): string {
  return joinPath(dirnameOf(output), `${stemOf(output)}.${format}`);
}

export function OcrPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const operation = useOperation(runOcr);
  const tools = useToolsStatusStore((state) => state.tools);
  const refreshTools = useToolsStatusStore((state) => state.refresh);
  const [languages, setLanguages] = useState<string[]>(() => {
    const preferred = usePreferencesStore.getState().ocrLanguage;
    return preferred ? [preferred] : defaultOcrLanguages(currentLocale());
  });
  const [dpi, setDpi] = useState(200);
  const [mode, setMode] = useState<OcrParams["mode"]>("skip_text");
  const [clean, setClean] = useState(false);
  const [exportText, setExportText] = useState(false);
  const [textFormat, setTextFormat] = useState<TextFormat>("txt");
  const [orientation, setOrientation] = useState(false);
  const [pages, setPages] = useState("");
  const [output, setOutput] = useState("");
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const source = sourceState.source;

  useEffect(() => {
    void refreshTools();
  }, [refreshTools]);

  useEffect(() => {
    if (source) setOutput(suggestOutputPath(source.path, "ocr"));
  }, [source]);

  useEffect(() => {
    setAnalysis(null);
    if (!source?.info) return;
    let cancelled = false;
    void analyzePages({ path: source.path, password: source.password ?? undefined })
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [source]);

  const available = tools?.ocrLanguages ?? defaultOcrLanguages(currentLocale());
  const activeLanguages = languages.filter((code) => available.includes(code));
  const pageCount = source?.info?.pageCount;
  const rangeInvalid = pageCount !== undefined && pages.trim() !== "" && pages.trim().toLowerCase() !== "all" && pagesInRanges(pages, pageCount) === null;
  const ready = !!source?.info && !!output && activeLanguages.length > 0 && !rangeInvalid;
  const textOutput = exportText && output ? textOutputFor(output, textFormat) : undefined;

  const run = () => {
    if (!source || !ready) return;
    void operation.run({ path: source.path, password: source.password ?? undefined, output, languages: activeLanguages, dpi, mode, orientation, clean, textOutput, pages: pages.trim() || undefined });
  };

  const result = operation.result;

  return (
    <ToolLayout
      title={t("nav.ocr")}
      icon={ScanText}
      description={t("tools.ocr.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t("tools.ocr.run")}
        </Button>
      }
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          <Section title={t("tools.ocr.languages")}>
            <div className="grid grid-cols-3 gap-x-4">
              {available.map((code) => (
                <Checkbox
                  key={code}
                  label={tesseractLanguageName(code, locale)}
                  checked={languages.includes(code)}
                  onChange={(checked) => setLanguages((state) => (checked ? [...state, code] : state.filter((item) => item !== code)))}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("tools.ocr.languagesHint")}</p>
            <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none text-muted-foreground">{t("tools.ocr.moreLanguages")}</summary>
              <TessdataManager />
            </details>
          </Section>
          <Section title={t("tools.ocr.mode")}>
            <OptionCards
              value={mode}
              onChange={setMode}
              ariaLabel={t("tools.ocr.mode")}
              options={[
                { value: "skip_text", title: t("tools.ocr.modes.skip_text.title"), description: t("tools.ocr.modes.skip_text.description") },
                { value: "force", title: t("tools.ocr.modes.force.title"), description: t("tools.ocr.modes.force.description") },
                { value: "redo", title: t("tools.ocr.modes.redo.title"), description: t("tools.ocr.modes.redo.description") },
              ]}
            />
            <SwitchField label={t("tools.ocr.orientation")} hint={t("tools.ocr.orientationHint")} checked={orientation} onChange={setOrientation} />
            <SwitchField label={t("tools.ocr.clean")} hint={t("tools.ocr.cleanHint")} checked={clean} onChange={setClean} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("tools.ocr.dpi")} hint={t("tools.ocr.dpiHint")}>
                <SelectInput value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
                  {[150, 200, 300].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </SelectInput>
              </Field>
              <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")} note={rangeInvalid ? <span className="text-destructive">{t("tools.merge.rangeInvalid")}</span> : undefined}>
                <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" aria-invalid={rangeInvalid || undefined} />
                {analysis ? (
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{t("tools.ocr.analysis", { scanned: analysis.scannedPages.length, text: analysis.pages.filter((page) => page.hasText).length, total: analysis.pageCount })}</span>
                    {analysis.scannedPages.length > 0 && analysis.scannedPages.length < analysis.pageCount ? (
                      <Button size="sm" variant="ghost" onClick={() => setPages(rangesOf(analysis.scannedPages))}>
                        {t("tools.ocr.onlyScanned")}
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </Field>
            </div>
          </Section>
          <Section>
            <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
            <SwitchField label={t("tools.ocr.exportText")} hint={textOutput ? t("tools.ocr.exportTextHint", { name: basenameOf(textOutput) }) : undefined} checked={exportText} onChange={setExportText} />
            {exportText ? (
              <Field label={t("tools.ocr.textFormat")}>
                <SelectInput value={textFormat} onChange={(event) => setTextFormat(event.target.value === "docx" ? "docx" : "txt")}>
                  <option value="txt">{t("tools.ocr.textFormats.txt")}</option>
                  <option value="docx">{t("tools.ocr.textFormats.docx")}</option>
                </SelectInput>
              </Field>
            ) : null}
          </Section>
        </>
      }
      result={
        <ResultPanel
          sourcePath={source?.path}
          sourcePassword={source?.password ?? undefined}
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? formatNumber(result.ocrPages, locale) : undefined}
          caption={result ? [t("tools.ocr.resultCaption", { skipped: result.skippedPages, rotated: result.rotatedPages }), result.redonePages ? t("tools.ocr.resultRedone", { count: result.redonePages }) : "", result.words ? t("tools.ocr.resultWords", { words: formatNumber(result.words, locale) }) : ""].filter(Boolean).join(" · ") : undefined}
          outputs={result ? [result.output, ...(result.textOutput ? [result.textOutput] : [])] : []}
          idleIcon={ScanText}
          idleTitle={t("tools.ocr.idle.title")}
          idleDescription={t("tools.ocr.idle.description")}
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

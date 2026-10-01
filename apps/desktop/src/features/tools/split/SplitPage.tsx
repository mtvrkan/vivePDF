import { useEffect, useState } from "react";
import { AlertTriangle, LayoutGrid, Lock, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox, Field, OptionCards, Section, Segmented, TextInput } from "@/components/tool/form";
import { OutputDirField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { formatNumber } from "@/shared/lib/format";
import { joinPath, outputDirectoryFor, stemOf } from "@/shared/lib/paths";
import { splitPdf } from "@/shared/rpc/operations";
import { useUiStore } from "@/shared/store/uiStore";
import { ScanSplitPreview } from "@/features/tools/scan/ScanSplitPreview";
import { CutPickerDialog } from "./CutPickerDialog";
import { splitParts, textSplitPattern } from "./splitParts";
import type { SplitMode } from "@/types";

const MODES: SplitMode[] = ["ranges", "every", "count", "single", "size", "odd_even", "bookmarks", "text"];
const BOOKMARK_LEVELS = [1, 2, 3] as const;
const MIN_PART_BYTES = 1024;

export function SplitPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const operation = useOperation(splitPdf);
  const [mode, setMode] = useState<SplitMode>("ranges");
  const [ranges, setRanges] = useState("");
  const [every, setEvery] = useState(1);
  const [partCount, setPartCount] = useState(2);
  const [bookmarkLevel, setBookmarkLevel] = useState<number>(1);
  const [maxMegabytes, setMaxMegabytes] = useState(5);
  const [outputDir, setOutputDir] = useState("");
  const [pattern, setPattern] = useState("");
  const [cutsOpen, setCutsOpen] = useState(false);
  const [textQuery, setTextQuery] = useState("");
  const [textRegex, setTextRegex] = useState(false);

  const source = sourceState.source;
  const parts = splitParts(ranges, source?.info?.pageCount ?? null);
  const textPattern = textSplitPattern(textQuery, textRegex);

  useEffect(() => {
    if (source) setOutputDir(joinPath(outputDirectoryFor(source.path), `${stemOf(source.path)}-${t("tools.split.suffix")}`));
  }, [source, t]);

  const ready =
    !!source?.info &&
    !!outputDir &&
    (mode !== "ranges" || !!parts) &&
    (mode !== "every" || every >= 1) &&
    (mode !== "count" || partCount >= 2) &&
    (mode !== "size" || Math.round(maxMegabytes * 1024 * 1024) >= MIN_PART_BYTES) &&
    (mode !== "bookmarks" || source.info.hasToc) &&
    (mode !== "text" || textPattern.length > 0);

  const run = () => {
    if (!source || !ready) return;
    void operation.run({
      path: source.path,
      password: source.password ?? undefined,
      mode,
      ranges: mode === "ranges" ? ranges : undefined,
      every: mode === "every" ? every : undefined,
      parts: mode === "count" ? partCount : undefined,
      bookmarkLevel: mode === "bookmarks" ? bookmarkLevel : undefined,
      maxBytes: mode === "size" ? Math.round(maxMegabytes * 1024 * 1024) : undefined,
      textPattern: mode === "text" ? textPattern : undefined,
      outputDir,
      pattern: pattern.trim() || undefined,
    });
  };

  const outputs = operation.result?.outputs ?? [];

  return (
    <ToolLayout
      title={t("nav.split")}
      icon={Scissors}
      description={t("tools.split.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t("tools.split.run")}
        </Button>
      }
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          <Section title={t("tools.split.mode")}>
            <OptionCards
              value={mode}
              onChange={setMode}
              ariaLabel={t("tools.split.mode")}
              options={MODES.map((value) => ({
                value,
                title: t(`tools.split.modes.${value}.title`),
                description: t(`tools.split.modes.${value}.description`),
              }))}
            />
            {mode === "ranges" ? (
              <Field
                label={t("tools.split.ranges")}
                hint={t("tools.split.partsHint")}
                note={
                  ranges.trim() ? (
                    parts ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{t("tools.split.partsPreview", { count: parts.length })}</span>
                        {parts.map((part, index) => (
                          <span key={index} className="glass-chip px-2 py-0.5 font-mono text-[11px] leading-5">{part.label}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-destructive">{t("tools.split.partsInvalid")}</p>
                    )
                  ) : null
                }
              >
                <div className="flex gap-2">
                  <TextInput value={ranges} onChange={(event) => setRanges(event.target.value)} placeholder="1-3; 4-6; 7-" className="font-mono" />
                  <Button icon={<LayoutGrid className="size-4" aria-hidden />} disabled={!source?.info || operation.running} onClick={() => setCutsOpen(true)}>
                    {t("tools.split.cuts.open")}
                  </Button>
                </div>
              </Field>
            ) : null}
            {source?.info && cutsOpen ? (
              <CutPickerDialog
                open
                path={source.path}
                password={source.password ?? undefined}
                pageCount={source.info.pageCount}
                ranges={ranges}
                onClose={() => setCutsOpen(false)}
                onApply={(value) => {
                  setRanges(value);
                  setCutsOpen(false);
                }}
              />
            ) : null}
            {mode === "every" ? (
              <Field label={t("tools.split.every")}>
                <TextInput type="number" min={1} value={every} onChange={(event) => setEvery(Math.max(1, Math.floor(Number(event.target.value)) || 1))} className="w-32 font-mono" />
              </Field>
            ) : null}
            {mode === "count" ? (
              <Field
                label={t("tools.split.partCount")}
                note={
                  source?.info && partCount >= 2 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("tools.split.partCountPreview", { count: Math.min(partCount, source.info.pageCount), pages: Math.ceil(source.info.pageCount / Math.min(partCount, source.info.pageCount)) })}
                    </p>
                  ) : null
                }
              >
                <TextInput type="number" min={2} value={partCount} max={10000} onChange={(event) => setPartCount(Math.max(2, Math.min(10000, Math.floor(Number(event.target.value)) || 2)))} className="w-32 font-mono" />
              </Field>
            ) : null}
            {mode === "bookmarks" && source?.info?.hasToc ? (
              <Field label={t("tools.split.bookmarkLevel")} hint={t("tools.split.bookmarkLevelHint")}>
                <Segmented value={bookmarkLevel} options={[...BOOKMARK_LEVELS]} labelOf={(level) => String(level)} onChange={setBookmarkLevel} ariaLabel={t("tools.split.bookmarkLevel")} size="sm" />
              </Field>
            ) : null}
            {mode === "size" ? (
              <Field label={t("tools.split.maxSize")}>
                <TextInput type="number" min={0.1} step={0.5} value={maxMegabytes} onChange={(event) => setMaxMegabytes(Number(event.target.value))} className="w-32 font-mono" />
              </Field>
            ) : null}
            {mode === "bookmarks" && source?.info && !source.info.hasToc ? (
              <p className="text-sm text-destructive">{t("tools.split.noBookmarks")}</p>
            ) : null}
            {mode === "text" ? (
              <>
                <Field label={t("tools.split.text.find")} hint={t(textRegex ? "tools.split.text.regexHint" : "tools.split.text.hint")}>
                  <TextInput value={textQuery} onChange={(event) => setTextQuery(event.target.value)} placeholder={textRegex ? "INVOICE NO[:\\s]*(\\S+)" : t("tools.split.text.placeholder")} disabled={operation.running} className={textRegex ? "font-mono" : undefined} />
                </Field>
                <Checkbox label={t("tools.split.text.regex")} checked={textRegex} onChange={setTextRegex} />
                {source ? (
                  <ScanSplitPreview
                    rules={{ path: source.path, password: source.password ?? undefined, mode: "text", textPattern, dropSeparators: true, minPages: 1 }}
                    ready={!!source.info && textPattern.length > 0}
                    disabled={operation.running}
                  />
                ) : null}
              </>
            ) : null}
          </Section>
          <Section>
            <OutputDirField value={outputDir} onChange={setOutputDir} disabled={operation.running} />
            <Field label={t("tools.split.pattern")} hint={t("tools.split.patternHint")}>
              <TextInput value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="{name}-{n}-p{first}-{last}" disabled={operation.running} className="font-mono" />
            </Field>
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
          numeral={operation.result ? formatNumber(outputs.length, locale) : undefined}
          caption={operation.result ? t("tools.split.parts") : undefined}
          outputs={outputs.map((part) => part.output)}
          idleIcon={Scissors}
          idleTitle={t("tools.split.idle.title")}
          idleDescription={t("tools.split.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {operation.result && operation.result.oversizedParts.length > 0 ? (
            <p role="status" className="flex items-center gap-2 px-4 py-2.5 text-sm text-warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {t("tools.split.oversized", { parts: operation.result.oversizedParts.join(", ") })}
            </p>
          ) : null}
          {operation.result?.protected ? (
            <p role="status" className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground">
              <Lock className="size-4 shrink-0" aria-hidden />
              {t("tools.split.partsProtected")}
            </p>
          ) : null}
        </ResultPanel>
      }
    />
  );
}

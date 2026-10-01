import { useEffect, useMemo, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FileCheck2, FileText, Image as ImageIcon, NotebookPen, Plus, ScanLine, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { Field, Section, SelectInput, Segmented, TextArea, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import { withinRange } from "@/shared/lib/numberRange";
import { basenameOf, defaultOutputDirectory, joinPath, outputDirectoryFor } from "@/shared/lib/paths";
import { toRpcError, type RpcCallOptions } from "@/shared/rpc/client";
import { isPdfPath } from "@/shared/rpc/files";
import { createOmrSheets, exportOmrResults, readOmrSheets, reviewOmrSheets } from "@/shared/rpc/operations";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import type { OmrFailure, OmrLetterCase, OmrPaper, OmrReadParams } from "@/types";
import { questionAnswers } from "@/features/viewer/overlay/question/placedQuestions";
import { AnswerKeyEditor } from "./AnswerKeyEditor";
import { OmrReview, OmrTable } from "./OmrResults";
import {
  bookletLetter,
  emptyKey,
  filledKeyCount,
  gradeAll,
  keyFromLetters,
  mergeOverride,
  OMR_LIMITS,
  PENALTIES,
  questionStats,
  questionsTable,
  resizeKey,
  reviewItems,
  reviewQuestions,
  studentsTable,
  type AnswerKey,
  type Overrides,
  type Penalty,
} from "./omrModel";

type Tab = "sheet" | "grade";
type ExportFormat = "xlsx" | "csv";

const TABS: Tab[] = ["sheet", "grade"];
const PAPERS: OmrPaper[] = ["a4", "letter"];
const LETTER_CASES: OmrLetterCase[] = ["upper", "lower"];
const OPTION_COUNTS = [2, 3, 4, 5, 6, 7, 8];
const BOOKLET_COUNTS = [1, 2, 3, 4];
const EXPORT_FORMATS: ExportFormat[] = ["xlsx", "csv"];
const SCAN_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "heic", "heif"];
const PENALTY_KEYS: Record<Penalty, string> = { 0: "none", 0.25: "quarter", [1 / 3]: "third" };
const SHOWN_FAILURES = 8;

const scanSheets = (params: OmrReadParams & { overwrite?: boolean }, options: RpcCallOptions) => readOmrSheets(params, options);

function isScanPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return SCAN_EXTENSIONS.includes(extension);
}

export function OmrPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const [tab] = useTabParam<Tab>(TABS, "sheet");

  const [paper, setPaper] = useState<OmrPaper>("a4");
  const [questions, setQuestions] = useState(40);
  const [options, setOptions] = useState(5);
  const [letterCase, setLetterCase] = useState<OmrLetterCase>("upper");
  const [idDigits, setIdDigits] = useState(8);
  const [booklets, setBooklets] = useState(1);
  const [copies, setCopies] = useState(30);
  const [title, setTitle] = useState("");
  const [hint, setHint] = useState(() => t("tools.omr.sheet.defaultHint"));
  const [sheetOutput, setSheetOutput] = useState("");
  const sheetOperation = useOperation(createOmrSheets);

  const [paths, setPaths] = useState<string[]>([]);
  const [penalty, setPenalty] = useState<Penalty>(0);
  const [key, setKey] = useState<AnswerKey>(() => emptyKey(1, 40));
  const [overrides, setOverrides] = useState<Overrides>({});
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [busy, setBusy] = useState<"export" | "review" | null>(null);
  const reading = useOperation(scanSheets);
  const objects = useViewerOverlayStore((state) => state.objects);
  const viewerAnswers = useMemo(() => questionAnswers(objects), [objects]);

  const scans = useMemo(() => reading.result?.sheets ?? [], [reading.result]);
  const failures = reading.result?.failures ?? [];
  const keyQuestions = scans.length ? Math.max(...scans.map((scan) => scan.questions)) : questions;
  const keyOptions = scans.length ? Math.max(...scans.map((scan) => scan.options)) : options;
  const keyBooklets = scans.length ? Math.max(...scans.map((scan) => scan.booklets)) : booklets;
  const sizedKey = useMemo(() => resizeKey(key, keyBooklets, keyQuestions), [key, keyBooklets, keyQuestions]);
  const graded = useMemo(() => gradeAll(scans, sizedKey, penalty, overrides), [scans, sizedKey, penalty, overrides]);
  const pending = useMemo(() => reviewItems(scans, overrides), [scans, overrides]);
  const keyFilled = sizedKey.some((row) => filledKeyCount(row) > 0);

  useEffect(() => {
    if (sheetOutput) return;
    void defaultOutputDirectory().then((directory) => setSheetOutput((current) => current || joinPath(directory, `${t("tools.omr.sheet.fileName")}.pdf`)));
  }, [sheetOutput, t]);

  useEffect(() => {
    setOverrides({});
  }, [reading.result]);

  useEffect(() => {
    if (tab !== "grade") return;
    const store = useDropTargetStore.getState();
    const previous = store.handler;
    store.setHandler((dropped) => {
      const usable = dropped.filter(isScanPath);
      if (usable.length > 0) setPaths((state) => [...state, ...usable.filter((path) => !state.includes(path))]);
    });
    return () => {
      useDropTargetStore.getState().setHandler(previous);
    };
  }, [tab]);

  const questionsValid = withinRange(questions, { min: 1, max: OMR_LIMITS.questions });
  const digitsValid = withinRange(idDigits, { min: 0, max: OMR_LIMITS.digits });
  const copiesValid = withinRange(copies, { min: 1, max: OMR_LIMITS.copies });
  const sheetReady = questionsValid && digitsValid && copiesValid && sheetOutput.length > 0;
  const gradeReady = paths.length > 0;

  const createSheets = () => {
    if (!sheetReady) return;
    void sheetOperation.run({
      output: sheetOutput,
      paper,
      questions,
      options,
      letterCase,
      idDigits,
      booklets,
      copies,
      title: title.trim(),
      labels: { name: t("tools.omr.sheet.nameLabel"), studentId: t("tools.omr.sheet.studentIdLabel"), booklet: t("tools.omr.sheet.bookletLabel"), hint: hint.trim() },
    });
  };

  const readSheets = () => {
    if (!gradeReady) return;
    void reading.run({ paths });
  };

  const pickScans = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: t("tools.omr.grade.scanFilter"), extensions: SCAN_EXTENSIONS }] });
    if (!selected) return;
    const list = (Array.isArray(selected) ? selected : [selected]).filter(isScanPath);
    setPaths((state) => [...state, ...list.filter((path) => !state.includes(path))]);
  };

  const useViewerAnswers = (booklet: number) => setKey(sizedKey.map((row, index) => (index === booklet ? keyFromLetters(viewerAnswers, keyQuestions, keyOptions) : row)));

  const tableTexts = () => ({
    student: t("tools.omr.results.columns.student"),
    source: t("tools.omr.results.columns.source"),
    booklet: t("tools.omr.results.columns.booklet"),
    correct: t("tools.omr.results.columns.correct"),
    wrong: t("tools.omr.results.columns.wrong"),
    blank: t("tools.omr.results.columns.blank"),
    net: t("tools.omr.results.columns.net"),
    percent: t("tools.omr.results.columns.percent"),
    question: t("tools.omr.results.columns.question"),
    key: t("tools.omr.results.columns.key"),
    answered: t("tools.omr.results.columns.answered"),
    correctShare: t("tools.omr.results.columns.correctShare"),
    blankShare: t("tools.omr.results.columns.blankShare"),
    studentsTitle: t("tools.omr.results.studentsSheet"),
    questionsTitle: t("tools.omr.results.questionsSheet"),
    basename: basenameOf,
  });

  const exportResults = async () => {
    if (graded.length === 0) return;
    const selected = await saveDialog({
      defaultPath: joinPath(outputDirectoryFor(paths[0]), `${t("tools.omr.export.fileName")}.${exportFormat}`),
      filters: [{ name: exportFormat === "xlsx" ? "Excel" : "CSV", extensions: [exportFormat] }],
    });
    if (!selected) return;
    setBusy("export");
    try {
      const texts = tableTexts();
      const tables = [studentsTable(graded, texts), questionsTable(questionStats(graded, keyOptions), keyOptions, texts)];
      const result = await exportOmrResults({ output: selected, overwrite: true, format: exportFormat, tables });
      toast("success", t("tools.omr.export.saved", { count: result.rows }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(null);
    }
  };

  const saveReview = async () => {
    const items = graded
      .filter((sheet) => sheet.booklet !== null)
      .map((sheet) => ({
        source: sheet.scan.source,
        page: sheet.scan.page,
        layout: sheet.scan.layout,
        transform: sheet.scan.transform,
        pixelScale: sheet.scan.pixelScale,
        header: t("tools.omr.export.reviewHeader", { student: sheet.studentId || "—", correct: sheet.correct, wrong: sheet.wrong, blank: sheet.blank, net: formatNumber(sheet.net, locale) }),
        questions: reviewQuestions(sheet),
      }));
    if (items.length === 0) return;
    const selected = await saveDialog({ defaultPath: joinPath(outputDirectoryFor(paths[0]), `${t("tools.omr.export.reviewFileName")}.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!selected) return;
    setBusy("review");
    try {
      const result = await reviewOmrSheets({ output: selected, overwrite: true, items });
      toast("success", t("tools.omr.export.reviewSaved", { count: result.pageCount }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(null);
    }
  };

  const failureText = (failure: OmrFailure) => {
    const where = failure.page === null ? basenameOf(failure.source) : t("tools.omr.results.sheetName", { number: failure.page, source: basenameOf(failure.source) });
    return `${where}: ${t(`tools.omr.failures.${failure.reason}`)}`;
  };

  const average = graded.length ? graded.reduce((sum, sheet) => sum + sheet.net, 0) / graded.length : 0;

  return (
    <ToolLayout
      title={t(`tools.omr.${tab}.title`)}
      description={t(`tools.omr.${tab}.description`)}
      icon={tab === "sheet" ? NotebookPen : FileCheck2}
      actions={
        tab === "sheet" ? (
          <Button variant="primary" onClick={createSheets} loading={sheetOperation.running} disabled={!sheetReady}>
            {t("tools.omr.sheet.run")}
          </Button>
        ) : (
          <Button variant="primary" onClick={readSheets} loading={reading.running} disabled={!gradeReady}>
            {t("tools.omr.grade.run")}
          </Button>
        )
      }
      form={
        tab === "sheet" ? (
          <>
            <Section title={t("tools.omr.sheet.layout")}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t("tools.omr.sheet.questions")} hint={questionsValid ? t("tools.omr.sheet.questionsHint") : t("tools.outOfRange", { min: 1, max: OMR_LIMITS.questions })}>
                  <TextInput type="number" min={1} max={OMR_LIMITS.questions} value={questions} onChange={(event) => setQuestions(event.target.valueAsNumber)} aria-invalid={!questionsValid || undefined} className="font-mono" />
                </Field>
                <Field label={t("tools.omr.sheet.options")}>
                  <SelectInput value={String(options)} aria-label={t("tools.omr.sheet.options")} onChange={(event) => setOptions(Number(event.target.value))}>
                    {OPTION_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        {t("tools.omr.sheet.optionCount", { count, last: String.fromCharCode(64 + count) })}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label={t("tools.omr.sheet.booklets")}>
                  <SelectInput value={String(booklets)} aria-label={t("tools.omr.sheet.booklets")} onChange={(event) => setBooklets(Number(event.target.value))}>
                    {BOOKLET_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        {count === 1 ? t("tools.omr.sheet.singleBooklet") : t("tools.omr.sheet.bookletCount", { last: bookletLetter(count - 1) })}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label={t("tools.omr.sheet.idDigits")} hint={digitsValid ? t("tools.omr.sheet.idDigitsHint") : t("tools.outOfRange", { min: 0, max: OMR_LIMITS.digits })}>
                  <TextInput type="number" min={0} max={OMR_LIMITS.digits} value={idDigits} onChange={(event) => setIdDigits(event.target.valueAsNumber)} aria-invalid={!digitsValid || undefined} className="font-mono" />
                </Field>
                <Field label={t("tools.omr.sheet.copies")} hint={copiesValid ? undefined : t("tools.outOfRange", { min: 1, max: OMR_LIMITS.copies })}>
                  <TextInput type="number" min={1} max={OMR_LIMITS.copies} value={copies} onChange={(event) => setCopies(event.target.valueAsNumber)} aria-invalid={!copiesValid || undefined} className="font-mono" />
                </Field>
                <Field label={t("tools.omr.sheet.paper")}>
                  <Segmented value={paper} options={PAPERS} labelOf={(value) => t(`tools.omr.sheet.papers.${value}`)} onChange={setPaper} ariaLabel={t("tools.omr.sheet.paper")} size="sm" />
                </Field>
              </div>
              <Field label={t("tools.omr.sheet.letterCase")}>
                <Segmented value={letterCase} options={LETTER_CASES} labelOf={(value) => t(`tools.omr.sheet.letterCases.${value}`)} onChange={setLetterCase} ariaLabel={t("tools.omr.sheet.letterCase")} size="sm" />
              </Field>
            </Section>
            <Section title={t("tools.omr.sheet.texts")}>
              <Field label={t("tools.omr.sheet.titleLabel")}>
                <TextInput value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder={t("tools.omr.sheet.titlePlaceholder")} />
              </Field>
              <Field label={t("tools.omr.sheet.hint")}>
                <TextArea value={hint} maxLength={400} rows={2} onChange={(event) => setHint(event.target.value)} />
              </Field>
            </Section>
            <Section>
              <OutputPathField value={sheetOutput} onChange={setSheetOutput} disabled={sheetOperation.running} />
            </Section>
          </>
        ) : (
          <>
            <Section title={t("tools.omr.grade.scans")}>
              {paths.length === 0 ? (
                <FileDropArea title={t("tools.omr.grade.dropTitle")} description={t("tools.omr.grade.dropHint")} onPick={() => void pickScans()} icon={ScanLine} />
              ) : (
                <>
                  <ol className="space-y-1.5">
                    {paths.map((path, index) => (
                      <li key={path} className="glass-chip flex h-11 items-center gap-3 rounded-xl px-3 text-sm">
                        <span className="w-5 font-mono text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                        {isPdfPath(path) ? <FileText className="size-4 shrink-0 text-(--tone)" aria-hidden /> : <ImageIcon className="size-4 shrink-0 text-(--tone)" aria-hidden />}
                        <span className="min-w-0 flex-1 truncate" title={path}>
                          {basenameOf(path)}
                        </span>
                        <IconButton icon={X} label={t("common.removeNamed", { name: basenameOf(path) })} disabled={reading.running} onClick={() => setPaths((state) => state.filter((item) => item !== path))} />
                      </li>
                    ))}
                  </ol>
                  <div className="flex gap-2">
                    <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void pickScans()} disabled={reading.running}>
                      {t("tools.batch.addFiles")}
                    </Button>
                    <Button variant="ghost" onClick={() => setPaths([])} disabled={reading.running}>
                      {t("tools.batch.clear")}
                    </Button>
                  </div>
                </>
              )}
            </Section>
            <Section title={t("tools.omr.key.title")}>
              <AnswerKeyEditor value={sizedKey} options={keyOptions} onChange={setKey} viewerAnswers={viewerAnswers.length} onUseViewerAnswers={useViewerAnswers} />
              <Field label={t("tools.omr.grade.penalty")} hint={t("tools.omr.grade.penaltyHint")}>
                <Segmented value={penalty} options={PENALTIES} labelOf={(value) => t(`tools.omr.grade.penalties.${PENALTY_KEYS[value]}`)} onChange={setPenalty} ariaLabel={t("tools.omr.grade.penalty")} size="sm" />
              </Field>
            </Section>
            {scans.length > 0 ? (
              <Section title={t("tools.omr.results.title")}>
                {!keyFilled ? <p className="text-sm text-muted-foreground">{t("tools.omr.results.noKey")}</p> : null}
                {pending.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">{t("tools.omr.review.intro", { count: pending.length })}</p>
                    <OmrReview items={pending} scans={scans} onOverride={(scan, change) => setOverrides((current) => mergeOverride(current, scan, change))} />
                  </div>
                ) : null}
                <OmrTable graded={graded} />
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented value={exportFormat} options={EXPORT_FORMATS} labelOf={(value) => t(`tools.omr.export.formats.${value}`)} onChange={setExportFormat} ariaLabel={t("tools.omr.export.format")} size="sm" />
                  <Button onClick={() => void exportResults()} loading={busy === "export"} disabled={busy !== null}>
                    {t("tools.omr.export.results")}
                  </Button>
                  <Button onClick={() => void saveReview()} loading={busy === "review"} disabled={busy !== null || !keyFilled}>
                    {t("tools.omr.export.review")}
                  </Button>
                </div>
              </Section>
            ) : null}
          </>
        )
      }
      result={
        tab === "sheet" ? (
          <ResultPanel
            status={sheetOperation.status}
            progress={sheetOperation.progress}
            error={sheetOperation.error}
            numeral={sheetOperation.result ? formatNumber(sheetOperation.result.pageCount, locale) : undefined}
            caption={sheetOperation.result ? t("tools.omr.sheet.created") : undefined}
            outputs={sheetOperation.result ? [sheetOperation.result.output] : []}
            idleIcon={NotebookPen}
            idleTitle={t("tools.omr.sheet.idleTitle")}
            idleDescription={t("tools.omr.sheet.idleDescription")}
            onCancel={sheetOperation.cancel}
            onRetry={createSheets}
            overwritePrompt={sheetOperation.overwritePrompt}
            onConfirmOverwrite={sheetOperation.confirmOverwrite}
            onDismissOverwrite={sheetOperation.dismissOverwrite}
          />
        ) : (
          <ResultPanel
            status={reading.status}
            progress={reading.progress}
            error={reading.error}
            numeral={reading.result ? formatNumber(scans.length, locale) : undefined}
            caption={reading.result ? t("tools.omr.grade.read") : undefined}
            outputs={[]}
            idleIcon={FileCheck2}
            idleTitle={t("tools.omr.grade.idleTitle")}
            idleDescription={t("tools.omr.grade.idleDescription")}
            onCancel={reading.cancel}
            onRetry={readSheets}
            overwritePrompt={null}
            onConfirmOverwrite={() => undefined}
            onDismissOverwrite={() => undefined}
          >
            {reading.result ? (
              <div role="status" className="space-y-2 px-4 py-2.5 text-sm text-foreground/80">
                {scans.length > 0 && keyFilled ? <p>{t("tools.omr.grade.average", { net: formatNumber(Math.round(average * 100) / 100, locale) })}</p> : null}
                {failures.length > 0 ? (
                  <>
                    <p className="flex items-center gap-2 font-medium">
                      <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                      {t("tools.omr.grade.failed", { count: failures.length })}
                    </p>
                    <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                      {failures.slice(0, SHOWN_FAILURES).map((failure) => (
                        <li key={`${failure.source}-${failure.page ?? 0}`}>{failureText(failure)}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </ResultPanel>
        )
      }
    />
  );
}

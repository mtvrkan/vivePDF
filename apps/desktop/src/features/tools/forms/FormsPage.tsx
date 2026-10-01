import { useEffect, useState, type ReactNode } from "react";
import { ClipboardList, Download, Eraser, FileText, Plus, RefreshCw, TriangleAlert, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Checkbox, Field, Section, SelectInput, TextInput } from "@/components/tool/form";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf, joinPath, outputDirectoryFor, stemOf, suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError, type RpcCallOptions } from "@/shared/rpc/client";
import { isPdfPath } from "@/shared/rpc/files";
import { withinRange } from "@/shared/lib/numberRange";
import { detectFormFields, exportFormData, exportForms, fillFormFields, importFormData, listFormFields, mergeForms, previewFormData, resetFormFields } from "@/shared/rpc/operations";
import { useUiStore } from "@/shared/store/uiStore";
import type { CsvDelimiter, DataPreviewResult, ExportDelimiter, FormField, FormMergeFailure, RpcError } from "@/types";
import { describeError } from "@/shared/lib/errorMessage";
import { summarizeFormsResult, type FormsResult } from "./formsResult";
import { changedValues, emptyRequired, FILLABLE_KINDS, initialValues, optionLabel, type FormValues } from "./fillValues";
import { toggleOption } from "./multiSelect";

type FieldsState = { status: "idle" | "loading" | "success" | "error"; fields: FormField[]; isForm: boolean; xfa: boolean; signed: boolean; error: RpcError | null };
const NO_FIELDS: FieldsState = { status: "idle", fields: [], isForm: false, xfa: false, signed: false, error: null };
type Tab = "fill" | "merge" | "export" | "detect";
const TABS: Tab[] = ["fill", "merge", "export", "detect"];
const SKIP = "__skip";
const DELIMITERS: Array<{ value: CsvDelimiter; key: string }> = [
  { value: "auto", key: "auto" },
  { value: ";", key: "semicolon" },
  { value: ",", key: "comma" },
  { value: "\t", key: "tab" },
  { value: "|", key: "pipe" },
];
const EXPORT_DELIMITERS = DELIMITERS.filter((option): option is { value: ExportDelimiter; key: string } => [",", ";", "\t"].includes(option.value));
const MERGEABLE_KINDS = ["text", "checkbox", "radio", "combobox", "listbox"];
const SHOWN_FAILURES = 5;
const MM_TO_PT = 72 / 25.4;
const MIN_LINE_MM = { min: 5, max: 200 };
const FIELD_HEIGHT_MM = { min: 3, max: 20 };

type FormsRun =
  | { tab: "fill"; params: Parameters<typeof fillFormFields>[0] }
  | { tab: "merge"; params: Parameters<typeof mergeForms>[0] }
  | { tab: "export"; params: Parameters<typeof exportForms>[0] }
  | { tab: "detect"; params: Parameters<typeof detectFormFields>[0] }
  | { tab: "reset"; params: Parameters<typeof resetFormFields>[0] }
  | { tab: "importData"; params: Parameters<typeof importFormData>[0] }
  | { tab: "exportData"; params: Parameters<typeof exportFormData>[0] };

function runForms(input: FormsRun & { overwrite?: boolean }, options: RpcCallOptions): Promise<FormsResult> {
  const overwrite = input.overwrite ?? input.params.overwrite;
  switch (input.tab) {
    case "fill":
      return fillFormFields({ ...input.params, overwrite }, options);
    case "merge":
      return mergeForms({ ...input.params, overwrite }, options);
    case "export":
      return exportForms({ ...input.params, overwrite }, options);
    case "detect":
      return detectFormFields({ ...input.params, overwrite }, options);
    case "reset":
      return resetFormFields({ ...input.params, overwrite }, options);
    case "importData":
      return importFormData({ ...input.params, overwrite }, options);
    case "exportData":
      return exportFormData({ ...input.params, overwrite }, options);
  }
}

function FormWarning({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground/80">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function normalizeKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function FormsPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const operation = useOperation(runForms);
  const [tab] = useTabParam<Tab>(TABS, "fill");
  const [fields, setFields] = useState<FieldsState>(NO_FIELDS);
  const [values, setValues] = useState<FormValues>({});
  const [initial, setInitial] = useState<FormValues>({});
  const [flatten, setFlatten] = useState(false);
  const [output, setOutput] = useState("");
  const [dataPath, setDataPath] = useState("");
  const [dataSheet, setDataSheet] = useState("");
  const [dataPreview, setDataPreview] = useState<DataPreviewResult | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [pattern, setPattern] = useState("{file}-{n}");
  const [delimiter, setDelimiter] = useState<CsvDelimiter>("auto");
  const [mergeDir, setMergeDir] = useState("");
  const [exportPaths, setExportPaths] = useState<string[]>([]);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv">("xlsx");
  const [exportDelimiter, setExportDelimiter] = useState<ExportDelimiter>(";");
  const [exportOutput, setExportOutput] = useState("");
  const [detectOutput, setDetectOutput] = useState("");
  const [minLineMm, setMinLineMm] = useState(18);
  const [fieldHeightMm, setFieldHeightMm] = useState(6);
  const [detectPages, setDetectPages] = useState("");
  const source = sourceState.source;

  useEffect(() => {
    if (!source?.info) {
      setFields(NO_FIELDS);
      setValues({});
      setInitial({});
      return;
    }
    setOutput(suggestOutputPath(source.path, t("tools.forms.suffix")));
    setMergeDir(joinPath(outputDirectoryFor(source.path), `${stemOf(source.path)}-${t("tools.forms.merge.suffix")}`));
    setDetectOutput(suggestOutputPath(source.path, t("tools.forms.detect.suffix")));
    let cancelled = false;
    setFields((state) => ({ ...state, status: "loading", error: null }));
    void listFormFields({ path: source.path, password: source.password ?? undefined })
      .then((result) => {
        if (cancelled) return;
        setFields({ status: "success", fields: result.fields, isForm: result.isForm, xfa: result.xfa, signed: result.signed ?? false, error: null });
        const loaded = initialValues(result.fields);
        setInitial(loaded);
        setValues(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFields({ ...NO_FIELDS, status: "error", error: toRpcError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [source, t]);

  const { setPath } = sourceState;

  useEffect(() => {
    if (tab !== "export") return;
    const store = useDropTargetStore.getState();
    store.setHandler((paths) => {
      const pdfs = paths.filter(isPdfPath);
      if (pdfs.length > 0) setExportPaths((state) => [...state, ...pdfs.filter((path) => !state.includes(path))]);
    });
    return () => {
      useDropTargetStore.getState().setHandler((paths) => {
        const pdf = paths.find(isPdfPath);
        if (pdf) void setPath(pdf);
      });
    };
  }, [tab, setPath]);

  useEffect(() => {
    if (exportPaths.length > 0 && !exportOutput) setExportOutput(joinPath(outputDirectoryFor(exportPaths[0]), `${t("tools.forms.export.suffix")}.${exportFormat}`));
  }, [exportPaths, exportOutput, exportFormat, t]);

  const editable = fields.fields.filter((field) => FILLABLE_KINDS.includes(field.kind) && !field.readOnly);
  const missingRequired = emptyRequired(editable, values);
  const flattening = flatten && !fields.signed;
  const mergeable = fields.fields.filter((field) => MERGEABLE_KINDS.includes(field.kind) && !field.readOnly);

  useEffect(() => {
    if (!dataPreview) return;
    const candidates = fields.fields.filter((field) => MERGEABLE_KINDS.includes(field.kind) && !field.readOnly);
    setMapping((state) => {
      let changed = false;
      const next = { ...state };
      for (const field of candidates) {
        if (next[field.name] !== undefined) continue;
        const keys = [normalizeKey(field.name), normalizeKey(field.label ?? "")].filter(Boolean);
        const guess = dataPreview.columns.find((column) => keys.includes(normalizeKey(column)));
        next[field.name] = guess ?? SKIP;
        changed = true;
      }
      return changed ? next : state;
    });
  }, [dataPreview, fields.fields]);

  const loadData = async (path: string, sheet: string, separator: CsvDelimiter) => {
    setDataError(null);
    try {
      const preview = await previewFormData({ path, sheet: sheet || undefined, delimiter: separator });
      setDataPreview(preview);
    } catch (caught) {
      setDataPreview(null);
      setDataError(describeError(t, toRpcError(caught)));
    }
  };

  const pickData = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "CSV / Excel", extensions: ["csv", "txt", "xlsx", "xlsm"] }] });
    if (typeof selected !== "string") return;
    setDataPath(selected);
    setDataSheet("");
    setDelimiter("auto");
    setMapping({});
    await loadData(selected, "", "auto");
  };

  const importData = async () => {
    if (!source || !output) return;
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "XFDF / FDF", extensions: ["xfdf", "fdf", "xml"] }] });
    if (typeof selected !== "string") return;
    void operation.run({ tab: "importData", params: { path: source.path, password: source.password ?? undefined, dataPath: selected, output, flatten: flattening } });
  };

  const exportData = async () => {
    if (!source) return;
    const selected = await saveDialog({
      defaultPath: joinPath(outputDirectoryFor(source.path), `${stemOf(source.path)}.xfdf`),
      filters: [
        { name: "XFDF", extensions: ["xfdf"] },
        { name: "FDF", extensions: ["fdf"] },
      ],
    });
    if (!selected) return;
    const format = selected.toLowerCase().endsWith(".fdf") ? "fdf" : "xfdf";
    void operation.run({ tab: "exportData", params: { path: source.path, password: source.password ?? undefined, output: selected, format, values } });
  };

  const pickExportFiles = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!selected) return;
    const list = Array.isArray(selected) ? selected : [selected];
    setExportPaths((state) => [...state, ...list.filter((path) => isPdfPath(path) && !state.includes(path))]);
  };

  const activeMapping = Object.fromEntries(Object.entries(mapping).filter(([, column]) => column && column !== SKIP));
  const mergeMapping = Object.fromEntries(mergeable.map((field) => [field.name, mapping[field.name] && mapping[field.name] !== SKIP ? mapping[field.name] : null]));
  const isSpreadsheet = /\.(xlsx|xlsm)$/i.test(dataPath);
  const minLineValid = withinRange(minLineMm, MIN_LINE_MM);
  const fieldHeightValid = withinRange(fieldHeightMm, FIELD_HEIGHT_MM);
  const ready =
    tab === "fill"
      ? !!source?.info && !!output && editable.length > 0
      : tab === "merge"
        ? !!source?.info && !!dataPreview && dataPreview.totalRows > 0 && Object.keys(activeMapping).length > 0 && mergeDir.length > 0 && pattern.trim().length > 0
        : tab === "export"
          ? exportPaths.length > 0 && exportOutput.length > 0
          : !!source?.info && detectOutput.length > 0 && minLineValid && fieldHeightValid;

  const run = () => {
    if (!ready) return;
    if (tab === "fill" && source) {
      const changed = changedValues(editable, initial, values);
      void operation.run({ tab, params: { path: source.path, password: source.password ?? undefined, output, values: changed, flatten: flattening } });
    } else if (tab === "merge" && source) {
      void operation.run({
        tab,
        params: { path: source.path, password: source.password ?? undefined, dataPath, sheet: dataSheet || undefined, delimiter: isSpreadsheet ? undefined : delimiter, outputDir: mergeDir, pattern: pattern.trim(), mapping: mergeMapping, flatten },
      });
    } else if (tab === "export") {
      void operation.run({ tab, params: { paths: exportPaths, output: exportOutput, format: exportFormat, delimiter: exportFormat === "csv" ? exportDelimiter : undefined, checkedLabel: t("common.yes"), uncheckedLabel: t("common.no") } });
    } else if (source) {
      void operation.run({
        tab: "detect",
        params: { path: source.path, password: source.password ?? undefined, output: detectOutput, pages: detectPages.trim() || undefined, minLineWidth: minLineMm * MM_TO_PT, fieldHeight: fieldHeightMm * MM_TO_PT },
      });
    }
  };

  const pages = [...new Set(editable.map((field) => field.page))];
  const result = operation.result;
  const summary = result ? summarizeFormsResult(result, t) : null;
  const numeral = summary ? formatNumber(summary.count, locale) : undefined;
  const caption = summary?.caption;
  const outputs = summary?.outputs ?? [];

  const signaturesBroken = fields.signed && !!result && "signaturesKept" in result && result.signaturesKept === false;
  const mergeFailures: FormMergeFailure[] = result && "unmatchedFields" in result ? (result.failed ?? []) : [];
  const describeFailure = (failure: FormMergeFailure) =>
    describeError(t, { code: failure.code, message: "", data: { reason: failure.reason ?? undefined, field: failure.field ?? "", value: failure.value ?? "" } });
  const resetOperation = operation.reset;

  useEffect(() => {
    resetOperation();
  }, [tab, resetOperation]);

  return (
    <ToolLayout
      title={t(`tools.forms.tabs.${tab}`)}
      icon={ClipboardList}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t(`tools.forms.${tab === "fill" ? "run" : `${tab}.run`}`, { count: tab === "export" ? exportPaths.length : dataPreview?.totalRows ?? 0 })}
        </Button>
      }
      form={
        <>
          {tab !== "export" ? (
            <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          ) : null}

          {tab === "fill" ? (
            <>
              {fields.status === "loading" ? <SkeletonCard lines={6} /> : null}
              {fields.status === "error" && fields.error ? (
                <ErrorState title={t("tools.failed")} message={describeError(t, fields.error)} />
              ) : null}
              {fields.status === "success" && editable.length === 0 ? (
                <EmptyState icon={ClipboardList} title={t("tools.forms.none.title")} description={t(fields.xfa ? "tools.forms.none.xfa" : "tools.forms.none.description")} />
              ) : null}
              {fields.status === "success" && editable.length > 0 ? (
                <>
                  {fields.xfa ? <FormWarning>{t("tools.forms.xfaWarning")}</FormWarning> : null}
                  {fields.signed ? <FormWarning>{t("tools.forms.signedWarning")}</FormWarning> : null}
                  {signaturesBroken ? <FormWarning>{t("tools.forms.signaturesBroken")}</FormWarning> : null}
                  {pages.map((page) => (
                    <Section key={page} title={`${t("info.pages")} ${page}`}>
                      {editable
                        .filter((field) => field.page === page)
                        .map((field, index) => {
                          const label = field.label || field.name;
                          const current = values[field.name];
                          const title = `${label}${field.required ? " *" : ""}`;
                          if (field.kind === "checkbox") {
                            return <Checkbox key={field.name} label={label} checked={current === true} onChange={(checked) => setValues((state) => ({ ...state, [field.name]: checked }))} />;
                          }
                          if (field.kind === "radio") {
                            return (
                              <Field key={field.name} label={title}>
                                <SelectInput value={typeof current === "string" ? current : ""} onChange={(event) => setValues((state) => ({ ...state, [field.name]: event.target.value }))}>
                                  <option value="">{t("tools.forms.noChoice")}</option>
                                  {field.options.map((option) => (
                                    <option key={option} value={option}>{optionLabel(field, option)}</option>
                                  ))}
                                </SelectInput>
                              </Field>
                            );
                          }
                          if (field.multiSelect) {
                            const picked = Array.isArray(current) ? current : [];
                            return (
                              <fieldset key={field.name} className="flex flex-col gap-1.5">
                                <legend className="mb-1 text-sm font-medium">{label}</legend>
                                <p className="text-xs text-muted-foreground">{t("tools.forms.multiSelectHint")}</p>
                                {field.options.map((option) => (
                                  <Checkbox
                                    key={option}
                                    label={optionLabel(field, option)}
                                    checked={picked.includes(option)}
                                    onChange={(checked) => setValues((state) => ({ ...state, [field.name]: toggleOption(field.options, state[field.name], option, checked) }))}
                                  />
                                ))}
                              </fieldset>
                            );
                          }
                          if (field.kind === "combobox" && field.editable) {
                            const listId = `form-choices-${page}-${index}`;
                            return (
                              <Field key={field.name} label={title} hint={t("tools.forms.editableHint")}>
                                <TextInput list={listId} value={typeof current === "string" ? current : ""} onChange={(event) => setValues((state) => ({ ...state, [field.name]: event.target.value }))} />
                                <datalist id={listId}>
                                  {field.options.map((option) => (
                                    <option key={option} value={option}>{optionLabel(field, option)}</option>
                                  ))}
                                </datalist>
                              </Field>
                            );
                          }
                          if (field.kind === "combobox" || field.kind === "listbox") {
                            return (
                              <Field key={field.name} label={title}>
                                <SelectInput value={typeof current === "string" ? current : ""} onChange={(event) => setValues((state) => ({ ...state, [field.name]: event.target.value }))}>
                                  <option value="">{t("tools.forms.noChoice")}</option>
                                  {field.options.map((option) => (
                                    <option key={option} value={option}>{optionLabel(field, option)}</option>
                                  ))}
                                </SelectInput>
                              </Field>
                            );
                          }
                          return (
                            <Field key={field.name} label={title} hint={field.maxLength ? t("tools.forms.maxLength", { count: field.maxLength }) : undefined}>
                              {field.multiline ? (
                                <textarea
                                  maxLength={field.maxLength ?? undefined}
                                  value={typeof current === "string" ? current : ""}
                                  onChange={(event) => setValues((state) => ({ ...state, [field.name]: event.target.value }))}
                                  rows={3}
                                  className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:border-ring"
                                />
                              ) : (
                                <TextInput maxLength={field.maxLength ?? undefined} value={typeof current === "string" ? current : ""} onChange={(event) => setValues((state) => ({ ...state, [field.name]: event.target.value }))} />
                              )}
                            </Field>
                          );
                        })}
                    </Section>
                  ))}
                  <Section>
                    {missingRequired.length > 0 ? (
                      <FormWarning>{t("tools.forms.requiredEmpty", { count: missingRequired.length, names: missingRequired.map((field) => field.label || field.name).join(", ") })}</FormWarning>
                    ) : null}
                    <Checkbox label={t("tools.forms.flatten")} hint={fields.signed ? t("tools.forms.flattenSigned") : undefined} checked={flattening} disabled={fields.signed} onChange={setFlatten} />
                    <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
                    <div className="flex flex-wrap gap-2">
                      <Button icon={<Upload className="size-4" aria-hidden />} disabled={!source || !output || operation.running} onClick={() => void importData()}>
                        {t("tools.forms.data.import")}
                      </Button>
                      <Button icon={<Download className="size-4" aria-hidden />} disabled={!source || operation.running} onClick={() => void exportData()}>
                        {t("tools.forms.data.export")}
                      </Button>
                      <Button
                        variant="ghost"
                        icon={<Eraser className="size-4" aria-hidden />}
                        disabled={!source || !output || operation.running}
                        onClick={() => {
                          if (!source || !output) return;
                          setValues(initial);
                          void operation.run({ tab: "reset", params: { path: source.path, password: source.password ?? undefined, output } });
                        }}
                      >
                        {t("tools.forms.reset")}
                      </Button>
                    </div>
                  </Section>
                </>
              ) : null}
            </>
          ) : null}

          {tab === "merge" ? (
            <>
              <Section title={t("tools.forms.merge.data")}>
                <p className="text-sm text-muted-foreground">{t("tools.forms.merge.hint")}</p>
                <Field label={t("tools.forms.merge.dataFile")}>
                  <div className="flex gap-2">
                    <TextInput value={dataPath ? basenameOf(dataPath) : ""} readOnly className="font-mono text-sm" />
                    <Button onClick={() => void pickData()}>{t("tools.browse")}</Button>
                  </div>
                </Field>
                {dataPreview && dataPreview.sheets.length > 1 ? (
                  <Field label={t("tools.forms.merge.sheet")}>
                    <SelectInput
                      value={dataSheet || dataPreview.sheets[0]}
                      onChange={(event) => {
                        setDataSheet(event.target.value);
                        void loadData(dataPath, event.target.value, delimiter);
                      }}
                      className="w-64"
                    >
                      {dataPreview.sheets.map((sheet) => (
                        <option key={sheet} value={sheet}>{sheet}</option>
                      ))}
                    </SelectInput>
                  </Field>
                ) : null}
                {dataPath && !isSpreadsheet ? (
                  <Field label={t("tools.forms.merge.delimiter")}>
                    <SelectInput
                      value={delimiter}
                      onChange={(event) => {
                        const next = event.target.value as CsvDelimiter;
                        setDelimiter(next);
                        setMapping({});
                        void loadData(dataPath, dataSheet, next);
                      }}
                      className="w-64"
                    >
                      {DELIMITERS.map((option) => (
                        <option key={option.key} value={option.value}>{t(`tools.forms.merge.delimiters.${option.key}`)}</option>
                      ))}
                    </SelectInput>
                  </Field>
                ) : null}
                {dataError ? <p className="text-sm text-destructive">{dataError}</p> : null}
                {dataPreview ? (
                  <p className="text-sm text-muted-foreground">{t("tools.forms.merge.rows", { rows: dataPreview.totalRows, columns: dataPreview.columns.length })}</p>
                ) : null}
              </Section>
              {dataPreview && fields.status === "success" ? (
                <Section title={t("tools.forms.merge.mapping")}>
                  {mergeable.length === 0 ? <p className="text-sm text-destructive">{t("tools.forms.none.description")}</p> : null}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {mergeable.map((field) => (
                      <Field key={field.name} label={field.label || field.name}>
                        <SelectInput value={mapping[field.name] ?? SKIP} onChange={(event) => setMapping((state) => ({ ...state, [field.name]: event.target.value }))}>
                          <option value={SKIP}>{t("tools.forms.merge.skip")}</option>
                          {dataPreview.columns.map((column) => (
                            <option key={column} value={column}>{column}</option>
                          ))}
                        </SelectInput>
                      </Field>
                    ))}
                  </div>
                </Section>
              ) : null}
              <Section>
                <Field label={t("tools.forms.merge.pattern")} hint={`${t("tools.forms.merge.patternHint")} ${(dataPreview?.columns ?? []).slice(0, 6).map((column) => `{${column}}`).join(" ")}`}>
                  <TextInput value={pattern} onChange={(event) => setPattern(event.target.value)} className="font-mono" />
                </Field>
                <Checkbox label={t("tools.forms.flatten")} checked={flatten} onChange={setFlatten} />
                <OutputDirField value={mergeDir} onChange={setMergeDir} disabled={operation.running} />
              </Section>
              {mergeFailures.length > 0 ? (
                <FormWarning>
                  {t("tools.forms.merge.failedRows", { count: mergeFailures.length })}
                  <ul className="mt-1 list-disc ps-5">
                    {mergeFailures.slice(0, SHOWN_FAILURES).map((failure) => (
                      <li key={failure.row}>{t("tools.forms.merge.failedRow", { row: failure.row, reason: describeFailure(failure) })}</li>
                    ))}
                  </ul>
                </FormWarning>
              ) : null}
            </>
          ) : null}

          {tab === "export" ? (
            <>
              <Section title={t("tools.batch.files")}>
                {exportPaths.length === 0 ? (
                  <FileDropArea title={t("tools.batch.dropTitle")} description={t("tools.forms.export.hint")} onPick={() => void pickExportFiles()} />
                ) : (
                  <ol className="space-y-1.5">
                    {exportPaths.map((path, index) => (
                      <li key={path} className="glass-chip flex h-11 items-center gap-3 rounded-xl px-3 text-sm">
                        <span className="w-5 font-mono text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                        <FileText className="size-4 shrink-0 text-(--tone)" aria-hidden />
                        <span className="min-w-0 flex-1 truncate" title={path}>{basenameOf(path)}</span>
                        <IconButton icon={X} label={t("common.removeNamed", { name: basenameOf(path) })} disabled={operation.running} onClick={() => setExportPaths((state) => state.filter((item) => item !== path))} />
                      </li>
                    ))}
                  </ol>
                )}
                {exportPaths.length > 0 ? (
                  <div className="flex gap-2">
                    <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void pickExportFiles()} disabled={operation.running}>
                      {t("tools.batch.addFiles")}
                    </Button>
                    <Button variant="ghost" onClick={() => setExportPaths([])} disabled={operation.running}>
                      {t("tools.batch.clear")}
                    </Button>
                  </div>
                ) : null}
              </Section>
              <Section>
                <Field label={t("tools.forms.export.format")}>
                  <SelectInput
                    value={exportFormat}
                    onChange={(event) => {
                      const next = event.target.value as "xlsx" | "csv";
                      setExportFormat(next);
                      setExportOutput((current) => (current ? current.replace(/\.(xlsx|csv)$/i, `.${next}`) : current));
                    }}
                    className="w-48"
                  >
                    <option value="xlsx">Excel (.xlsx)</option>
                    <option value="csv">CSV</option>
                  </SelectInput>
                </Field>
                {exportFormat === "csv" ? (
                  <Field label={t("tools.forms.merge.delimiter")}>
                    <SelectInput value={exportDelimiter} onChange={(event) => setExportDelimiter(event.target.value as ExportDelimiter)} className="w-48">
                      {EXPORT_DELIMITERS.map((option) => (
                        <option key={option.key} value={option.value}>{t(`tools.forms.merge.delimiters.${option.key}`)}</option>
                      ))}
                    </SelectInput>
                  </Field>
                ) : null}
                <OutputPathField value={exportOutput} onChange={setExportOutput} disabled={operation.running} extension={exportFormat} />
              </Section>
            </>
          ) : null}

          {tab === "detect" ? (
            <>
              <Section title={t("tools.forms.detect.title")}>
                <p className="text-sm text-muted-foreground">{t("tools.forms.detect.hint")}</p>
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t("tools.forms.detect.minLine")} hint={minLineValid ? undefined : t("tools.outOfRange", MIN_LINE_MM)}>
                    <TextInput type="number" min={MIN_LINE_MM.min} max={MIN_LINE_MM.max} value={Number.isNaN(minLineMm) ? "" : minLineMm} onChange={(event) => setMinLineMm(event.target.valueAsNumber)} aria-invalid={!minLineValid || undefined} className="font-mono" />
                  </Field>
                  <Field label={t("tools.forms.detect.fieldHeight")} hint={fieldHeightValid ? undefined : t("tools.outOfRange", FIELD_HEIGHT_MM)}>
                    <TextInput type="number" min={FIELD_HEIGHT_MM.min} max={FIELD_HEIGHT_MM.max} value={Number.isNaN(fieldHeightMm) ? "" : fieldHeightMm} onChange={(event) => setFieldHeightMm(event.target.valueAsNumber)} aria-invalid={!fieldHeightValid || undefined} className="font-mono" />
                  </Field>
                  <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
                    <TextInput value={detectPages} onChange={(event) => setDetectPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
                  </Field>
                </div>
                {result && "fields" in result && Array.isArray(result.fields) && "scannedPages" in result && result.scannedPages && result.scannedPages.length > 0 ? (
                  <p className="text-sm text-muted-foreground">{t("tools.forms.detect.scanned", { count: result.scannedPages.length })}</p>
                ) : null}
                {result && "fields" in result && Array.isArray(result.fields) && !("filled" in result) ? (
                  <ul className="rounded-lg border text-sm">
                    {result.fields.map((field) => (
                      <li key={field.name} className="flex items-center gap-3 border-b px-3 py-1.5 last:border-b-0">
                        <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{t("viewer.comments.pageShort", { page: field.page })}</span>
                        <span className="w-24 shrink-0 text-xs text-muted-foreground">{t(`tools.forms.detect.kinds.${field.kind}`)}</span>
                        <span title={field.name} className="min-w-0 flex-1 truncate font-mono">{field.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Section>
              <Section>
                <OutputPathField value={detectOutput} onChange={setDetectOutput} disabled={operation.running} />
              </Section>
            </>
          ) : null}
        </>
      }
      result={
        <ResultPanel
          sourcePath={tab === "export" ? undefined : source?.path}
          sourcePassword={source?.password ?? undefined}
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={numeral}
          caption={caption}
          outputs={outputs}
          idleIcon={RefreshCw}
          idleTitle={t("tools.forms.idle.title")}
          idleDescription={t(tab === "fill" ? "tools.forms.idle.description" : "tools.forms.idle.descriptionOther")}
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

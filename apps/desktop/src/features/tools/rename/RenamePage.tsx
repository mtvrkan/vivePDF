import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { ArrowDownWideNarrow, ArrowRight, ArrowUpNarrowWide, Plus, Tags, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox, Field, OptionCards, Section, SelectInput, TextInput } from "@/components/tool/form";
import { OutputDirField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { defaultOcrLanguages } from "@/app/locales";
import { useOperation } from "@/shared/hooks/useOperation";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { isPdfPath } from "@/shared/rpc/files";
import { applyRename, previewRename, undoRename } from "@/shared/rpc/operations";
import { useLaunchStore } from "@/shared/store/launchStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import { useUiStore } from "@/shared/store/uiStore";
import { renamedPaths, unknownTokens } from "./renamePattern";
import { CONFLICT_POLICIES, PRESETS, SORT_KEYS, extensionOf, failureKey, policyParams, sortPaths, undoPlan, withoutKey, type ConflictPolicy, type SortKey } from "./renameOptions";
import { useRenameHistoryStore } from "./renameHistoryStore";
import { RenameRow } from "./RenameRow";
import type { RenameCase, RenameDateOrder, RenameItem, RenamePreviewParams, RpcError } from "@/types";

type Mode = "rename" | "copy";
const MODES: Mode[] = ["rename", "copy"];
const TOKENS = ["name", "n", "title", "date", "year", "invoice", "amount", "author", "subject", "pages"] as const;
const DATE_FORMATS: Array<{ value: string; sample: string }> = [
  { value: "%Y-%m-%d", sample: "2026-09-18" },
  { value: "%d.%m.%Y", sample: "18.09.2026" },
  { value: "%Y%m%d", sample: "20260918" },
  { value: "%d-%m-%Y", sample: "18-09-2026" },
  { value: "%m-%d-%Y", sample: "09-18-2026" },
];
const DATE_ORDERS: RenameDateOrder[] = ["dmy", "mdy"];
const CASES: RenameCase[] = ["keep", "lower", "upper", "title"];
const COUNTER_DIGITS = [0, 1, 2, 3, 4, 5, 6] as const;
const DEFAULT_PATTERN = "{date} {title}";
const PREVIEW_DELAY_MS = 450;
const CUSTOM_TOKEN = "custom";
const BASE_TOKENS: string[] = [...TOKENS, "ext", "time"];

type UndoState = { status: "idle" } | { status: "running" } | { status: "done"; restored: number; failed: number } | { status: "error"; error: RpcError };

function whole(value: string, min: number, max: number, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function RenamePage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const operation = useOperation(applyRename);
  const tools = useToolsStatusStore((state) => state.tools);
  const [paths, setPaths] = useState<string[]>([]);
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);
  const [customRegex, setCustomRegex] = useState("");
  const [dateFormat, setDateFormat] = useState(DATE_FORMATS[0].value);
  const [dateOrder, setDateOrder] = useState<RenameDateOrder>(locale === "en" ? "mdy" : "dmy");
  const [counterStart, setCounterStart] = useState(1);
  const [counterStep, setCounterStep] = useState(1);
  const [counterDigits, setCounterDigits] = useState(0);
  const [nameCase, setNameCase] = useState<RenameCase>("keep");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [ocr, setOcr] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [descending, setDescending] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [policy, setPolicy] = useState<ConflictPolicy>("number");
  const lastRunMode = useRef<Mode>("rename");
  const [mode, setMode] = useState<Mode>("rename");
  const [outputDir, setOutputDir] = useState("");
  const [preview, setPreview] = useState<RenameItem[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<RpcError | null>(null);
  const [undoState, setUndoState] = useState<UndoState>({ status: "idle" });
  const history = useRenameHistoryStore((state) => state.last);
  const timerRef = useRef<number | null>(null);

  const addPaths = useCallback((incoming: string[]) => {
    const pdfs = incoming.filter(isPdfPath);
    if (pdfs.length === 0) return;
    setPaths((state) => [...state, ...pdfs.filter((path) => !state.includes(path))]);
  }, []);

  useEffect(() => {
    const setHandler = useDropTargetStore.getState().setHandler;
    setHandler(addPaths);
    return () => setHandler(null);
  }, [addPaths]);

  const pendingPath = useLaunchStore((state) => state.pendingPath);
  const pendingPaths = useLaunchStore((state) => state.pendingPaths);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!pendingPath && pendingPaths.length === 0) return;
    const store = useLaunchStore.getState();
    const launched = store.consumeAll(isPdfPath, pathname);
    const single = launched.length > 0 ? null : store.consumeIf(isPdfPath, pathname);
    addPaths(single ? [single] : launched);
  }, [pendingPath, pendingPaths, pathname, addPaths]);

  const renameResult = operation.result;
  useEffect(() => {
    if (!renameResult || lastRunMode.current !== "rename") return;
    const moved = new Map(renameResult.results.filter((entry) => entry.ok && entry.output).map((entry) => [entry.path, entry.output as string]));
    setPaths((state) => renamedPaths(state, renameResult.results));
    setOverrides({});
    setPasswords((state) => Object.fromEntries(Object.entries(state).map(([path, password]) => [moved.get(path) ?? path, password])));
    const plan = undoPlan(renameResult);
    if (plan) useRenameHistoryStore.getState().remember(plan, renameResult.results.filter((entry) => entry.replaced).length);
    setUndoState({ status: "idle" });
  }, [renameResult]);

  useEffect(() => {
    if (!useToolsStatusStore.getState().tools) void useToolsStatusStore.getState().refresh();
  }, []);

  const ocrLanguages = useMemo(() => {
    const available = tools?.ocrLanguages ?? [];
    return defaultOcrLanguages(locale).filter((code) => available.includes(code));
  }, [tools, locale]);

  const strayFields = unknownTokens(pattern, customRegex.trim() ? [...BASE_TOKENS, CUSTOM_TOKEN] : BASE_TOKENS);
  const previewByPath = useMemo(() => new Map(preview.map((item) => [item.path, item])), [preview]);
  const orderedPaths = useMemo(() => sortPaths(paths, previewByPath, sortKey, descending), [paths, previewByPath, sortKey, descending]);
  const orderKey = orderedPaths.join("\n");

  const request = useMemo<Omit<RenamePreviewParams, "paths">>(
    () => ({
      pattern,
      dateFormat,
      dateOrder,
      customPatterns: customRegex.trim() ? { [CUSTOM_TOKEN]: customRegex } : ({} as Record<string, string>),
      counterStart,
      counterStep,
      counterDigits,
      case: nameCase,
      turkishCase: locale === "tr",
      replacements: find ? [{ find, replace, regex: useRegex }] : [],
      overrides,
      passwords,
      ocr: ocr && ocrLanguages.length > 0,
      ocrLanguages,
    }),
    [pattern, dateFormat, dateOrder, customRegex, counterStart, counterStep, counterDigits, nameCase, locale, find, replace, useRegex, overrides, passwords, ocr, ocrLanguages],
  );

  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const ordered = orderKey ? orderKey.split("\n") : [];
    if (ordered.length === 0 || !request.pattern.trim()) {
      setPreview([]);
      setPreviewError(null);
      setPreviewing(false);
      return;
    }
    let current = true;
    const controller = new AbortController();
    setPreviewing(true);
    timerRef.current = window.setTimeout(() => {
      previewRename({ ...request, paths: ordered }, { signal: controller.signal })
        .then((result) => {
          if (!current) return;
          setPreview(result.items);
          setPreviewError(null);
        })
        .catch((error: unknown) => {
          if (!current) return;
          setPreview([]);
          setPreviewError(toRpcError(error));
        })
        .finally(() => {
          if (current) setPreviewing(false);
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      controller.abort();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [orderKey, request]);

  const pickFiles = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!selected) return;
    addPaths(Array.isArray(selected) ? selected : [selected]);
  };

  const removePath = useCallback((path: string) => {
    setPaths((state) => state.filter((item) => item !== path));
    setOverrides((state) => withoutKey(state, path));
    setPasswords((state) => withoutKey(state, path));
  }, []);
  const changeOverride = useCallback((path: string, value: string | null) => setOverrides((state) => (value === null ? withoutKey(state, path) : { ...state, [path]: value })), []);
  const changePassword = useCallback((path: string, password: string) => setPasswords((state) => ({ ...state, [path]: password })), []);
  const clearAll = () => {
    setPaths([]);
    setOverrides({});
    setPasswords({});
  };

  const readyItems = preview.filter((item) => !item.error);
  const conflictCount = readyItems.filter((item) => item.conflict).length;
  const ready = readyItems.length > 0 && !previewing && (mode === "rename" || outputDir.length > 0);

  const run = () => {
    if (!ready) return;
    lastRunMode.current = mode;
    void operation.run({
      items: readyItems.map((item) => ({ path: item.path, newName: item.newName })),
      mode,
      outputDir: mode === "copy" ? outputDir : undefined,
      ...policyParams(policy),
    });
  };

  const runUndo = () => {
    if (!history || undoState.status === "running") return;
    setUndoState({ status: "running" });
    undoRename({ items: history.items, removeDirs: history.removeDirs })
      .then((result) => {
        setPaths((state) => renamedPaths(state, result.results));
        useRenameHistoryStore.getState().forget();
        operation.reset();
        setUndoState({ status: "done", restored: result.restored, failed: result.results.filter((entry) => !entry.ok).length });
      })
      .catch((error: unknown) => setUndoState({ status: "error", error: toRpcError(error) }));
  };

  const insertToken = (token: string) => setPattern((state) => `${state}${state.endsWith(" ") || state.length === 0 ? "" : " "}{${token}}`);
  const firstPreview = readyItems[0] ?? null;
  const result = operation.result;
  const failures = result ? result.results.filter((entry) => !entry.ok) : [];
  const conflictNote = t(`tools.rename.conflicts.${policy}`);

  return (
    <ToolLayout
      title={t("nav.rename")}
      icon={Tags}
      description={t("tools.rename.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t(`tools.rename.run.${mode}`, { count: readyItems.length })}
        </Button>
      }
      form={
        <>
          {history || undoState.status !== "idle" ? (
            <div role="status" className="card flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <Undo2 className="size-4 shrink-0 text-(--tone)" aria-hidden />
              <span className="min-w-0 flex-1">
                {undoState.status === "done"
                  ? [t("tools.rename.undo.done", { count: undoState.restored }), undoState.failed > 0 ? t("tools.rename.undo.failed", { count: undoState.failed }) : null].filter(Boolean).join(" ")
                  : undoState.status === "error"
                    ? describeError(t, undoState.error)
                    : history
                      ? [t("tools.rename.undo.available", { count: history.items.length }), history.replaced > 0 ? t("tools.rename.undo.replaced", { count: history.replaced }) : null].filter(Boolean).join(" ")
                      : null}
              </span>
              {history ? (
                <Button size="sm" icon={<Undo2 className="size-4" aria-hidden />} loading={undoState.status === "running"} disabled={operation.running} onClick={runUndo}>
                  {t("tools.rename.undo.run")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <Section title={t("tools.batch.files")}>
            {paths.length === 0 ? (
              <FileDropArea title={t("tools.batch.dropTitle")} description={t("tools.batch.dropDescription")} onPick={() => void pickFiles()} />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-foreground/80">{t("tools.rename.sort.label")}</span>
                    <SelectInput value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="w-44">
                      {SORT_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {t(`tools.rename.sort.${key}`)}
                        </option>
                      ))}
                    </SelectInput>
                  </label>
                  <IconButton
                    icon={descending ? ArrowDownWideNarrow : ArrowUpNarrowWide}
                    label={t(descending ? "tools.rename.sort.descending" : "tools.rename.sort.ascending")}
                    active={descending}
                    onClick={() => setDescending((state) => !state)}
                  />
                </div>
                <ol className="space-y-1.5">
                  {orderedPaths.map((path, index) => (
                    <RenameRow
                      key={path}
                      path={path}
                      position={index}
                      item={previewByPath.get(path)}
                      override={overrides[path]}
                      triedPassword={path in passwords}
                      conflictNote={conflictNote}
                      disabled={operation.running}
                      onOverride={changeOverride}
                      onPassword={changePassword}
                      onRemove={removePath}
                    />
                  ))}
                </ol>
              </>
            )}
            {paths.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void pickFiles()} disabled={operation.running}>
                  {t("tools.batch.addFiles")}
                </Button>
                <Button variant="ghost" onClick={clearAll} disabled={operation.running}>
                  {t("tools.batch.clear")}
                </Button>
                {previewing ? <span className="text-xs text-muted-foreground">{t(ocr ? "tools.rename.previewingOcr" : "tools.rename.previewing")}</span> : null}
                {previewError ? <span className="text-xs text-destructive">{describeError(t, previewError)}</span> : null}
              </div>
            ) : null}
          </Section>

          <Section title={t("tools.rename.pattern")}>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("tools.rename.presets.label")}>
              {PRESETS.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => setPattern(preset.pattern)}
                    aria-pressed={pattern === preset.pattern}
                    className={cn(
                      "glass-chip flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-(--transition-fast) hover:text-primary",
                      pattern === preset.pattern && "border-primary text-primary",
                    )}
                    title={preset.pattern}
                  >
                    {t(`tools.rename.presets.${preset.id}`)}
                  </button>
                </li>
              ))}
            </ul>
            <Field
              label={t("tools.rename.pattern")}
              hint={t("tools.rename.patternHint")}
              note={
                <>
                  {strayFields.length > 0 ? (
                    <p className="mt-2 text-xs text-warning">
                      {t("tools.rename.unknownField", { fields: strayFields.map((field) => `{${field}}`).join(", ") })}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">{t("tools.rename.folderHint")}</p>
                </>
              }
            >
              <TextInput value={pattern} onChange={(event) => setPattern(event.target.value)} className="font-mono" />
            </Field>
            <div className="card flex min-h-11 items-center gap-2 px-3 py-2 text-sm">
              {previewing ? (
                <span className="text-muted-foreground">{t("tools.rename.previewing")}</span>
              ) : firstPreview ? (
                <>
                  <span className="min-w-0 truncate text-muted-foreground" title={firstPreview.path}>
                    {basenameOf(firstPreview.path)}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className={cn("min-w-0 truncate font-medium", firstPreview.conflict ? "text-warning" : "text-foreground")} title={firstPreview.newName}>
                    {firstPreview.newName}
                    {extensionOf(firstPreview.path)}
                  </span>
                  {readyItems.length > 1 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{t("tools.rename.previewMore", { count: readyItems.length - 1 })}</span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">{t("tools.rename.previewEmpty")}</span>
              )}
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {[...TOKENS, ...(customRegex.trim() ? [CUSTOM_TOKEN] : [])].map((token) => (
                <li key={token}>
                  <button
                    type="button"
                    onClick={() => insertToken(token)}
                    className="glass-chip flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-(--transition-fast) hover:text-primary"
                    title={t(`tools.rename.tokens.${token}`)}
                  >
                    <span className="font-mono">{`{${token}}`}</span>
                    <span className="text-muted-foreground">{t(`tools.rename.tokens.${token}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Field label={t("tools.rename.customRegex")} hint={t("tools.rename.customRegexHint")}>
              <TextInput value={customRegex} onChange={(event) => setCustomRegex(event.target.value)} placeholder="Müşteri[:\s]+([A-Za-zÇĞİÖŞÜçğıöşü ]+)" className="font-mono" />
            </Field>
          </Section>

          <Section title={t("tools.rename.options")}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("tools.rename.dateFormat")}>
                <SelectInput value={dateFormat} onChange={(event) => setDateFormat(event.target.value)} aria-label={t("tools.rename.dateFormat")} className="font-mono">
                  {DATE_FORMATS.map((format) => (
                    <option key={format.value} value={format.value}>
                      {format.sample}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label={t("tools.rename.dateOrder.label")} hint={t("tools.rename.dateOrder.hint")}>
                <SelectInput value={dateOrder} onChange={(event) => setDateOrder(event.target.value as RenameDateOrder)} aria-label={t("tools.rename.dateOrder.label")}>
                  {DATE_ORDERS.map((order) => (
                    <option key={order} value={order}>
                      {t(`tools.rename.dateOrder.${order}`)}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("tools.rename.counter.start")}>
                <TextInput type="number" min={0} value={counterStart} onChange={(event) => setCounterStart(whole(event.target.value, 0, 1_000_000_000, 1))} className="font-mono" />
              </Field>
              <Field label={t("tools.rename.counter.step")}>
                <TextInput type="number" min={1} value={counterStep} onChange={(event) => setCounterStep(whole(event.target.value, 1, 1_000_000, 1))} className="font-mono" />
              </Field>
              <Field label={t("tools.rename.counter.digits")}>
                <SelectInput value={String(counterDigits)} onChange={(event) => setCounterDigits(Number(event.target.value))} aria-label={t("tools.rename.counter.digits")}>
                  {COUNTER_DIGITS.map((digits) => (
                    <option key={digits} value={digits}>
                      {digits === 0 ? t("tools.rename.counter.auto") : "0".repeat(digits - 1) + "1"}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>
            <Field label={t("tools.rename.case.label")}>
              <SelectInput value={nameCase} onChange={(event) => setNameCase(event.target.value as RenameCase)} aria-label={t("tools.rename.case.label")} className="w-56">
                {CASES.map((value) => (
                  <option key={value} value={value}>
                    {t(`tools.rename.case.${value}`)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("tools.rename.replace.find")}>
                <TextInput value={find} onChange={(event) => setFind(event.target.value)} maxLength={200} className="font-mono" />
              </Field>
              <Field label={t("tools.rename.replace.with")}>
                <TextInput value={replace} onChange={(event) => setReplace(event.target.value)} maxLength={200} className="font-mono" />
              </Field>
            </div>
            <Checkbox label={t("tools.rename.replace.regex")} hint={t("tools.rename.replace.regexHint")} checked={useRegex} onChange={setUseRegex} />
            <Checkbox
              label={t("tools.rename.ocr")}
              hint={ocrLanguages.length > 0 ? t("tools.rename.ocrHint") : t("tools.rename.ocrMissing")}
              checked={ocr && ocrLanguages.length > 0}
              disabled={ocrLanguages.length === 0}
              onChange={setOcr}
            />
          </Section>

          <Section title={t("tools.rename.mode")}>
            <OptionCards
              value={mode}
              onChange={setMode}
              ariaLabel={t("tools.rename.mode")}
              options={MODES.map((value) => ({ value, title: t(`tools.rename.modes.${value}.title`), description: t(`tools.rename.modes.${value}.description`) }))}
            />
            {mode === "copy" ? <OutputDirField value={outputDir} onChange={setOutputDir} disabled={operation.running} /> : null}
            <Field label={t("tools.rename.policy.label")} hint={t(`tools.rename.policy.${policy}Hint`)}>
              <SelectInput value={policy} onChange={(event) => setPolicy(event.target.value as ConflictPolicy)} aria-label={t("tools.rename.policy.label")} className="w-64">
                {CONFLICT_POLICIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`tools.rename.policy.${value}`)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {conflictCount > 0 ? <p className="text-xs text-warning">{t("tools.rename.conflictCount", { count: conflictCount })}</p> : null}
          </Section>
        </>
      }
      result={
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? formatNumber(result.renamed, locale) : undefined}
          caption={result ? t("tools.rename.renamed", { failed: failures.length }) : undefined}
          outputs={result ? result.results.filter((entry) => entry.ok && entry.output).map((entry) => entry.output as string) : []}
          idleIcon={Tags}
          idleTitle={t("tools.rename.idle.title")}
          idleDescription={t("tools.rename.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {failures.length > 0 ? (
            <section className="border-t px-4 py-3" aria-label={t("tools.rename.failure.title")}>
              <h3 className="text-sm font-medium">{t("tools.rename.failure.title")}</h3>
              <ul className="mt-2 max-h-48 space-y-1.5 overflow-auto">
                {failures.map((entry) => (
                  <li key={entry.path} className="text-xs">
                    <span className="block truncate font-mono" title={entry.path}>
                      {basenameOf(entry.path)}
                    </span>
                    <span className="text-destructive">{t(failureKey(entry.error), { name: entry.output ? basenameOf(entry.output) : "", detail: entry.error ?? "" })}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </ResultPanel>
      }
    />
  );
}

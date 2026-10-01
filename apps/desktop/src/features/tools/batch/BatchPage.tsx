import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bookmark, CheckCircle2, CircleDashed, FileDown, FileText, FileUp, FolderPlus, KeyRound, Layers, Loader2, Lock, Plus, RotateCcw, Save, ShieldOff, Trash2, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { PasswordBreachWarning } from "@/components/shared/PasswordBreachNote";
import { Select } from "@/components/shared/Select";
import { Checkbox, Field, Section, SelectInput, TextInput } from "@/components/tool/form";
import { OutputDirField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { cn } from "@/shared/lib/cn";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { formatBytes } from "@/shared/lib/format";
import { basenameOf, dirnameOf, joinPath } from "@/shared/lib/paths";
import { readOutputPattern } from "@/shared/lib/naming";
import { toRpcError } from "@/shared/rpc/client";
import { deleteChainSecret, storeChainSecret } from "@/shared/rpc/chainSecrets";
import { isPdfPath, readDocumentBytes } from "@/shared/rpc/files";
import { getDocumentInfo } from "@/shared/rpc/documents";
import { listPdfs, mergePdfs } from "@/shared/rpc/operations";
import { useHistoryStore } from "@/shared/store/historyStore";
import { useLaunchStore } from "@/shared/store/launchStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { CompressProfile, ImageFormat, OperationStatus, PageScopeKind, RpcError, RpcProgress } from "@/types";
import { PAGE_SCOPE_KINDS } from "@/shared/lib/pageScope";
import { describeError } from "@/shared/lib/errorMessage";
import {
  OPERATIONS,
  PDF_OPERATIONS,
  ROTATE_DEGREES,
  chainIsValid,
  chainProducesPdf,
  chainOutputPath,
  claimFreeOutputPath,
  createChainContext,
  defaultStepSettings,
  mergeChains,
  nameTemplateIsValid,
  parseChainFile,
  persistSavedChains,
  readSavedChains,
  runChain,
  secretKindsOf,
  secretsToRemember,
  serializeChains,
  stepIsReady,
  upsertChain,
  type BatchOperation,
  type SavedChain,
  type StepSettings,
} from "./chain";
import { HeaderFooterStepFields, MetadataStepFields, PdfaStepFields, WatermarkStepFields } from "./StepFields";

type ItemStatus = "pending" | "running" | "done" | "error";
type BatchItem = { path: string; status: ItemStatus; step?: number; output?: string; outputPassword?: string; bytes?: number; error?: RpcError; locked?: boolean; password?: string; wrongPassword?: boolean };
type BatchStep = { id: string; operation: BatchOperation; settings: StepSettings };

const PROFILES: CompressProfile[] = ["light", "balanced", "strong", "extreme"];
const newStep = (operation: BatchOperation): BatchStep => ({ id: crypto.randomUUID(), operation, settings: defaultStepSettings() });

function LockedItem({ path, wrongPassword, onUnlock, disabled }: { path: string; wrongPassword?: boolean; onUnlock: (path: string, password: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (password) onUnlock(path, password);
      }}
      className="flex shrink-0 items-center gap-2"
    >
      <Lock className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="w-32">
        <TextInput
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("password.label")}
          aria-label={t("password.label")}
          className="h-8 rounded-lg bg-background/60 text-xs"
        />
      </span>
      <Button size="sm" type="submit" variant="primary" disabled={!password || disabled}>
        {t("password.open")}
      </Button>
      {wrongPassword ? <span className="text-xs text-destructive">{t("password.wrong")}</span> : null}
    </form>
  );
}

export function BatchPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const addHistory = useHistoryStore((state) => state.add);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [steps, setSteps] = useState<BatchStep[]>([newStep("compress")]);
  const [pendingOperation, setPendingOperation] = useState<BatchOperation>("ocr");
  const [mergeAtEnd, setMergeAtEnd] = useState(false);
  const [mergedOutput, setMergedOutput] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<RpcError | null>(null);
  const [chains, setChains] = useState<SavedChain[]>(() => readSavedChains());
  const [chainName, setChainName] = useState("");
  const [rememberSecrets, setRememberSecrets] = useState(false);
  const [savingChain, setSavingChain] = useState(false);
  const [useSourceFolder, setUseSourceFolder] = useState(true);
  const [nameTemplate, setNameTemplate] = useState("");
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [scanningFolder, setScanningFolder] = useState(false);
  const [outputDir, setOutputDir] = useState("");
  const [status, setStatus] = useState<OperationStatus>("idle");
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const contextRef = useRef(createChainContext());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const runningRef = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;
  const pushToast = useToastStore((state) => state.push);
  const mergedName = `${t("tools.batch.mergedName")}.pdf`;

  const probeLocks = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      try {
        await getDocumentInfo({ path });
      } catch (error) {
        if (toRpcError(error).code !== "NEEDS_PASSWORD") continue;
        setItems((state) => state.map((item) => (item.path === path ? { ...item, locked: true } : item)));
      }
    }
  }, []);

  const addPaths = useCallback((paths: string[]) => {
    const pdfs = paths.filter(isPdfPath);
    if (pdfs.length === 0) return;
    if (runningRef.current) {
      useToastStore.getState().push("info", tRef.current("tools.batch.busyAdding"));
      return;
    }
    const known = new Set(itemsRef.current.map((item) => item.path));
    const fresh = Array.from(new Set(pdfs.filter((path) => !known.has(path))));
    if (fresh.length === 0) return;
    setItems((state) => {
      const present = new Set(state.map((item) => item.path));
      return [...state, ...fresh.filter((path) => !present.has(path)).map((path) => ({ path, status: "pending" as ItemStatus }))];
    });
    void probeLocks(fresh);
  }, [probeLocks]);

  const unlockItem = async (path: string, password: string) => {
    try {
      await getDocumentInfo({ path, password });
      setItems((state) => state.map((item) => (item.path === path ? { ...item, password, locked: false, wrongPassword: false } : item)));
    } catch {
      setItems((state) => state.map((item) => (item.path === path ? { ...item, wrongPassword: true } : item)));
    }
  };

  useEffect(() => {
    const setHandler = useDropTargetStore.getState().setHandler;
    setHandler(addPaths);
    const launched = useLaunchStore.getState().consumeAll(isPdfPath);
    if (launched.length > 0) addPaths(launched);
    return () => setHandler(null);
  }, [addPaths]);

  const pickFiles = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!selected) return;
    addPaths(Array.isArray(selected) ? selected : [selected]);
  };

  const pickFolder = async () => {
    const selected = await openDialog({ multiple: false, directory: true });
    if (typeof selected !== "string") return;
    const name = basenameOf(selected) || selected;
    setScanningFolder(true);
    try {
      const listed = await listPdfs({ folder: selected, recursive: includeSubfolders });
      if (listed.files.length === 0) pushToast("info", t("tools.batch.folderEmpty", { name }));
      else addPaths(listed.files);
      if (listed.truncated) pushToast("info", t("tools.batch.folderTruncated", { count: listed.files.length }));
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
    } finally {
      setScanningFolder(false);
    }
  };

  const removeItem = (path: string) => setItems((state) => state.filter((item) => item.path !== path));
  const clearItems = () => setItems([]);

  const producesPdf = chainProducesPdf(steps);
  const chainValid = chainIsValid(steps);
  const locked = items.some((item) => item.locked);
  const templateValid = nameTemplateIsValid(nameTemplate);
  const ready = items.length > 0 && !locked && chainValid && steps.every((step) => stepIsReady(step)) && templateValid && (useSourceFolder || outputDir.length > 0);
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const exampleSource = items[0]?.path ?? `${t("tools.batch.exampleName")}.pdf`;
  const exampleName = lastStep && templateValid ? basenameOf(chainOutputPath(exampleSource, lastStep.operation, "", lastStep.settings.format, false, steps.length - 1, { template: nameTemplate, n: 1 })) : "";
  const done = items.filter((item) => item.status === "done");
  const failed = items.filter((item) => item.status === "error");
  const running = status === "running";

  const updateStep = (id: string, patch: Partial<StepSettings>) =>
    setSteps((state) => state.map((step) => (step.id === id ? { ...step, settings: { ...step.settings, ...patch } } : step)));
  const removeStep = (id: string) => setSteps((state) => state.filter((step) => step.id !== id));
  const moveStep = (index: number, delta: number) =>
    setSteps((state) => {
      const target = index + delta;
      if (target < 0 || target >= state.length) return state;
      const next = [...state];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const canAdd = PDF_OPERATIONS.has(pendingOperation) || producesPdf;
  const addStep = () => {
    if (!canAdd) return;
    setSteps((state) => [...state, newStep(pendingOperation)]);
  };

  const rememberable = secretsToRemember(steps).length > 0;
  const saveChain = async () => {
    const name = chainName.trim();
    if (!name || steps.length === 0 || savingChain) return;
    const plainSteps = steps.map(({ operation, settings }) => ({ operation, settings }));
    const previous = chains.find((chain) => chain.name === name);
    let next = upsertChain(chains, name, plainSteps, mergeAtEnd, templateValid ? nameTemplate : "");
    const saved = next.find((chain) => chain.name === name);
    if (!saved) return;
    setSavingChain(true);
    try {
      const kept = new Set(saved.storedSecrets ?? []);
      for (const kind of previous?.storedSecrets ?? []) {
        if (!kept.has(kind)) await deleteChainSecret(saved.id, kind).catch(() => undefined);
      }
      if (rememberSecrets && rememberable) {
        try {
          for (const item of secretsToRemember(plainSteps)) {
            await storeChainSecret(saved.id, item.kind, item.secret, item.certificatePath);
            kept.add(item.kind);
          }
          pushToast("success", t("tools.batch.secretsStored"));
        } catch (error) {
          pushToast("error", describeError(t, toRpcError(error)));
        }
        const stored = secretKindsOf(plainSteps).filter((kind) => kept.has(kind));
        next = next.map((chain) => (chain.id === saved.id ? { ...chain, storedSecrets: stored } : chain));
      }
      setChains(next);
      persistSavedChains(next);
      setChainName("");
    } finally {
      setSavingChain(false);
    }
  };
  const forgetSecrets = async (chain: SavedChain) => {
    try {
      await deleteChainSecret(chain.id);
      const next = chains.map((item) => (item.id === chain.id ? { ...item, storedSecrets: undefined } : item));
      setChains(next);
      persistSavedChains(next);
      pushToast("success", t("tools.batch.secretsForgotten"));
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
    }
  };
  const loadChain = (chain: SavedChain) => {
    setSteps(chain.steps.map((step) => ({ id: crypto.randomUUID(), operation: step.operation, settings: { ...defaultStepSettings(), ...step.settings } })));
    setMergeAtEnd(chain.mergeAtEnd);
    setNameTemplate(chain.nameTemplate ?? "");
  };
  const deleteChain = (id: string) => {
    const removed = chains.find((chain) => chain.id === id);
    const previous = chains.map((chain) => (chain.id === id ? { ...chain, storedSecrets: undefined } : chain));
    const next = chains.filter((chain) => chain.id !== id);
    if (removed?.storedSecrets?.length) void deleteChainSecret(id).catch(() => undefined);
    setChains(next);
    persistSavedChains(next);
    pushToast("info", t("tools.batch.chainDeleted", { name: removed?.name ?? "" }), {
      label: t("common.undo"),
      onClick: () => {
        setChains(previous);
        persistSavedChains(previous);
      },
    });
  };
  const exportChains = async () => {
    const path = await saveDialog({ defaultPath: `${t("tools.batch.chainsFileName")}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    try {
      await invoke("write_text_file", { path, contents: serializeChains(chains) });
      pushToast("success", t("tools.batch.chainsExported", { count: chains.length }));
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
    }
  };
  const importChains = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof selected !== "string") return;
    try {
      const bytes = await readDocumentBytes(selected);
      const incoming = parseChainFile(new TextDecoder().decode(bytes));
      const { chains: next, replacedIds } = mergeChains(chains, incoming);
      for (const id of replacedIds) {
        if (chains.find((chain) => chain.id === id)?.storedSecrets?.length) await deleteChainSecret(id).catch(() => undefined);
      }
      setChains(next);
      persistSavedChains(next);
      pushToast("success", t("tools.batch.chainsImported", { count: incoming.length }));
    } catch (error) {
      const rpcError = toRpcError(error);
      pushToast("error", rpcError.code === "INTERNAL" ? t("tools.batch.chainsImportFailed") : describeError(t, rpcError));
    }
  };

  const run = async (onlyFailed = false) => {
    if (!ready || runningRef.current) return;
    const targets = onlyFailed ? items.filter((item) => item.status === "error") : items;
    if (targets.length === 0) return;
    const targetPaths = new Set(targets.map((item) => item.path));
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    if (!onlyFailed) contextRef.current = createChainContext();
    const context = contextRef.current;
    setStatus("running");
    setCancelled(false);
    setMergedOutput(null);
    setMergeError(null);
    setItems((state) => state.map((item) => (targetPaths.has(item.path) ? { ...item, status: "pending", step: undefined, output: undefined, outputPassword: undefined, error: undefined } : item)));
    const total = targets.length;
    const directory = useSourceFolder ? "" : outputDir;
    const outputs: string[] = [];
    const finished = new Map<string, { path: string; password?: string }>();
    if (onlyFailed) {
      for (const item of items) if (item.status === "done" && item.output) finished.set(item.path, { path: item.output, password: item.outputPassword });
    }
    const ordinals = new Map(items.map((item, position) => [item.path, position + 1]));
    for (let index = 0; index < total; index += 1) {
      if (controller.signal.aborted) break;
      const path = targets[index].path;
      setProgress({ id: "batch", progress: index / total, message: "progress.batch", detail: { current: index + 1, total } });
      setItems((state) => state.map((item) => (item.path === path ? { ...item, status: "running", step: 0 } : item)));
      try {
        const result = await runChain(
          steps,
          path,
          directory,
          controller.signal,
          (step) => setItems((state) => state.map((item) => (item.path === path ? { ...item, step } : item))),
          targets[index].password,
          context,
          { template: nameTemplate, n: ordinals.get(path) ?? index + 1 },
        );
        outputs.push(result.output);
        finished.set(path, { path: result.output, password: result.password });
        setItems((state) => state.map((item) => (item.path === path ? { ...item, status: "done", output: result.output, outputPassword: result.password, bytes: result.bytes } : item)));
      } catch (error) {
        if (controller.signal.aborted) {
          setItems((state) => state.map((item) => (item.path === path ? { ...item, status: "pending", step: undefined } : item)));
          break;
        }
        setItems((state) => state.map((item) => (item.path === path ? { ...item, status: "error", error: toRpcError(error) } : item)));
      }
    }
    const mergeInputs = items.flatMap((item) => finished.get(item.path) ?? []);
    if (mergeAtEnd && producesPdf && mergeInputs.length > 1 && !controller.signal.aborted) {
      const target = await claimFreeOutputPath(joinPath(useSourceFolder ? dirnameOf(mergeInputs[0].path) : outputDir, mergedName), context.taken);
      setProgress({ id: "batch", progress: 0.95, message: "progress.merging", detail: { current: mergeInputs.length, total: mergeInputs.length } });
      try {
        const merged = await mergePdfs({ inputs: mergeInputs, output: target, overwrite: false, addBookmarks: true }, { signal: controller.signal });
        setMergedOutput(merged.output);
        outputs.push(merged.output);
      } catch (error) {
        if (!controller.signal.aborted) setMergeError(toRpcError(error));
      }
    }
    if (outputs.length > 0) addHistory({ tool: "/tools/batch", source: null, outputs });
    setProgress(null);
    setCancelled(controller.signal.aborted);
    setStatus("success");
    controllerRef.current = null;
    runningRef.current = false;
  };

  const cancel = () => controllerRef.current?.abort();

  const operationLabel = (operation: BatchOperation) => t(`tools.batch.operations.${operation}.title`);
  const operationOptions = useMemo(
    () => OPERATIONS.map((value) => ({ value, label: t(`tools.batch.operations.${value}.title`), disabled: !PDF_OPERATIONS.has(value) && !producesPdf })),
    [t, producesPdf],
  );

  const stepSettingsField = (step: BatchStep) => {
    switch (step.operation) {
      case "compress":
        return (
          <Field label={t("tools.compress.profile")}>
            <SelectInput value={step.settings.profile} onChange={(event) => updateStep(step.id, { profile: event.target.value as CompressProfile })} className="w-64">
              {PROFILES.map((value) => (
                <option key={value} value={value}>
                  {t(`tools.compress.profiles.${value}.title`)}
                </option>
              ))}
            </SelectInput>
          </Field>
        );
      case "ocr":
        return (
          <Field label={t("tools.ocr.languages")} hint={t("tools.batch.languagesHint")}>
            <TextInput value={step.settings.languages} onChange={(event) => updateStep(step.id, { languages: event.target.value })} className="w-64 font-mono" />
          </Field>
        );
      case "removeWatermark":
        return (
          <Field label={t("tools.security.removeWatermark.text")} hint={t("tools.batch.watermarkHint")}>
            <TextInput value={step.settings.watermarkText} onChange={(event) => updateStep(step.id, { watermarkText: event.target.value })} className="w-64" />
          </Field>
        );
      case "number":
        return (
          <div className="grid grid-cols-5 gap-3">
            <Field label={t("tools.edit.number.template")}>
              <TextInput value={step.settings.numberTemplate} onChange={(event) => updateStep(step.id, { numberTemplate: event.target.value })} className="font-mono" />
            </Field>
            <Field label={t("tools.edit.number.prefix")}>
              <TextInput value={step.settings.numberPrefix} onChange={(event) => updateStep(step.id, { numberPrefix: event.target.value })} className="font-mono" />
            </Field>
            <Field label={t("tools.edit.number.padding")}>
              <TextInput type="number" min={0} max={12} value={step.settings.numberPadding} onChange={(event) => updateStep(step.id, { numberPadding: Number(event.target.value) })} className="font-mono" />
            </Field>
            <Field label={t("tools.edit.number.start")}>
              <TextInput type="number" min={0} value={step.settings.numberStart} onChange={(event) => updateStep(step.id, { numberStart: Number(event.target.value) })} className="font-mono" />
            </Field>
            <div className="flex items-end pb-1">
              <Checkbox label={t("tools.batch.numberContinue")} hint={t("tools.batch.numberContinueHint")} checked={step.settings.numberContinue} onChange={(value) => updateStep(step.id, { numberContinue: value })} />
            </div>
          </div>
        );
      case "rotate":
      case "delete":
      case "extract":
        return (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("tools.pageTools.pages")}>
              <SelectInput value={step.settings.pageScope} onChange={(event) => updateStep(step.id, { pageScope: event.target.value as PageScopeKind })} className="w-44">
                {PAGE_SCOPE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`tools.pageTools.scope.${value}`)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {step.settings.pageScope === "every" ? (
              <>
                <Field label={t("tools.pageTools.every")}>
                  <TextInput type="number" min={1} value={step.settings.pageEvery} onChange={(event) => updateStep(step.id, { pageEvery: Math.max(1, Math.floor(Number(event.target.value)) || 1) })} className="w-24 font-mono" />
                </Field>
                <Field label={t("tools.pageTools.start")}>
                  <TextInput type="number" min={1} value={step.settings.pageStart} onChange={(event) => updateStep(step.id, { pageStart: Math.max(1, Math.floor(Number(event.target.value)) || 1) })} className="w-24 font-mono" />
                </Field>
              </>
            ) : null}
            {step.settings.pageScope === "ranges" ? (
              <Field label={t("tools.batch.pageRanges")} hint={t("tools.pageTools.rangesHint")}>
                <TextInput value={step.settings.pageRanges} onChange={(event) => updateStep(step.id, { pageRanges: event.target.value })} placeholder="1-3, 7, 10-" className="w-56 font-mono" />
              </Field>
            ) : null}
            {step.operation === "rotate" ? (
              <Field label={t("tools.pageTools.degrees.title")}>
                <SelectInput value={step.settings.rotateDegrees} onChange={(event) => updateStep(step.id, { rotateDegrees: Number(event.target.value) })} className="w-44">
                  {ROTATE_DEGREES.map((value) => (
                    <option key={value} value={value}>
                      {t(`tools.pageTools.degrees.${value}`)}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : null}
          </div>
        );
      case "encrypt":
        return (
          <Field label={t("tools.security.encrypt.userPassword")} hint={t("tools.batch.passwordHint")} note={step.settings.password ? <PasswordBreachWarning password={step.settings.password} /> : null}>
            <TextInput type="password" value={step.settings.password} onChange={(event) => updateStep(step.id, { password: event.target.value })} className="w-64" autoComplete="new-password" />
          </Field>
        );
      case "sign":
        return (
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("tools.sign.sign.certificate")} hint={t("tools.batch.certificateHint")}>
              <div className="flex gap-2">
                <TextInput value={step.settings.certificatePath ? basenameOf(step.settings.certificatePath) : ""} readOnly className="font-mono text-sm" />
                <Button
                  onClick={() =>
                    void openDialog({ multiple: false, directory: false, filters: [{ name: "PKCS#12", extensions: ["p12", "pfx"] }] }).then((selected) => {
                      if (typeof selected === "string") updateStep(step.id, { certificatePath: selected });
                    })
                  }
                >
                  {t("tools.browse")}
                </Button>
              </div>
            </Field>
            <Field label={t("tools.sign.sign.certificatePassword")}>
              <TextInput type="password" value={step.settings.certificatePassword} onChange={(event) => updateStep(step.id, { certificatePassword: event.target.value })} autoComplete="off" />
            </Field>
            <Field label={t("tools.sign.sign.reason")}>
              <TextInput value={step.settings.reason} onChange={(event) => updateStep(step.id, { reason: event.target.value })} />
            </Field>
          </div>
        );
      case "watermark":
        return <WatermarkStepFields settings={step.settings} onChange={(patch) => updateStep(step.id, patch)} />;
      case "headerFooter":
        return <HeaderFooterStepFields settings={step.settings} onChange={(patch) => updateStep(step.id, patch)} />;
      case "metadata":
        return <MetadataStepFields settings={step.settings} onChange={(patch) => updateStep(step.id, patch)} />;
      case "pdfa":
        return <PdfaStepFields settings={step.settings} onChange={(patch) => updateStep(step.id, patch)} />;
      case "images":
        return (
          <Field label={t("tools.convert.imageFormat")}>
            <SelectInput value={step.settings.format} onChange={(event) => updateStep(step.id, { format: event.target.value as ImageFormat })} className="w-40">
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="webp">WebP</option>
            </SelectInput>
          </Field>
        );
      default:
        return null;
    }
  };

  return (
    <ToolLayout
      title={t("nav.batch")}
      description={t("tools.batch.description")}
      icon={Layers}
      actions={
        <Button variant="primary" onClick={() => void run()} loading={running} disabled={!ready}>
          {t("tools.batch.run", { count: items.length })}
        </Button>
      }
      form={
        <>
          <Section title={t("tools.batch.files")}>
            {items.length === 0 ? (
              <FileDropArea title={t("tools.batch.dropTitle")} description={t("tools.batch.dropDescription")} onPick={() => void pickFiles()} disabled={scanningFolder} />
            ) : (
              <ol className="space-y-1.5">
                {items.map((item, index) => (
                  <li key={item.path} className="glass-chip flex h-11 items-center gap-3 rounded-xl px-3 text-sm">
                    <span className="w-5 font-mono text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    {item.status === "running" ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
                    ) : item.status === "done" ? (
                      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                    ) : item.status === "error" ? (
                      <XCircle className="size-4 shrink-0 text-destructive" aria-hidden />
                    ) : (
                      <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <FileText className="size-4 shrink-0 text-(--tone)" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={item.path}>
                      {item.path.split(/[\\/]/).pop()}
                    </span>
                    {item.locked ? <LockedItem path={item.path} wrongPassword={item.wrongPassword} onUnlock={(path, password) => void unlockItem(path, password)} disabled={running} /> : null}
                    <span title={item.status === "running" && item.step !== undefined && steps[item.step] ? `${item.step + 1}/${steps.length} · ${operationLabel(steps[item.step].operation)}` : item.status === "done" && item.output ? item.output : item.status === "error" && item.error ? describeError(t, item.error) : undefined} className={cn("max-w-1/2 shrink-0 truncate font-mono text-xs", item.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                      {item.status === "running" && item.step !== undefined && steps[item.step] ? `${item.step + 1}/${steps.length} · ${operationLabel(steps[item.step].operation)}` : ""}
                      {item.status === "done" && item.output ? basenameOf(item.output) : ""}
                      {item.status === "done" && item.output && item.bytes !== undefined ? " · " : ""}
                      {item.status === "done" && item.bytes !== undefined ? formatBytes(item.bytes, locale) : ""}
                      {item.status === "error" && item.error ? describeError(t, item.error) : ""}
                    </span>
                    <IconButton icon={X} label={t("common.removeNamed", { name: basenameOf(item.path) })} disabled={running} onClick={() => removeItem(item.path)} />
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {items.length > 0 ? (
                <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void pickFiles()} disabled={running}>
                  {t("tools.batch.addFiles")}
                </Button>
              ) : null}
              <Button icon={<FolderPlus className="size-4" aria-hidden />} onClick={() => void pickFolder()} loading={scanningFolder} disabled={running || scanningFolder}>
                {t("tools.batch.addFolder")}
              </Button>
              <Checkbox label={t("tools.batch.includeSubfolders")} checked={includeSubfolders} onChange={setIncludeSubfolders} disabled={running || scanningFolder} />
              {items.length > 0 ? (
                <Button variant="ghost" onClick={clearItems} disabled={running}>
                  {t("tools.batch.clear")}
                </Button>
              ) : null}
            </div>
          </Section>

          <Section title={t("tools.batch.chain")}>
            <p className="text-sm text-muted-foreground">{t("tools.batch.chainHint")}</p>
            {steps.length === 0 ? <p className="text-sm text-warning">{t("tools.batch.noSteps")}</p> : null}
            <ol className="space-y-2">
              {steps.map((step, index) => {
                const settingsField = stepSettingsField(step);
                return (
                  <li key={step.id} className="glass-chip rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--tone-soft) font-mono text-xs font-semibold tabular-nums text-(--tone)">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{operationLabel(step.operation)}</span>
                        <span className="block text-xs text-muted-foreground">{t(`tools.batch.operations.${step.operation}.description`)}</span>
                      </span>
                      <IconButton icon={ArrowUp} label={t("tools.merge.moveUp")} disabled={index === 0 || running} onClick={() => moveStep(index, -1)} />
                      <IconButton icon={ArrowDown} label={t("tools.merge.moveDown")} disabled={index === steps.length - 1 || running} onClick={() => moveStep(index, 1)} />
                      <IconButton icon={Trash2} label={t("tools.batch.removeStep")} disabled={running} onClick={() => removeStep(step.id)} />
                    </div>
                    {settingsField ? (
                      <fieldset disabled={running} className="mt-2 ps-10">
                        {settingsField}
                      </fieldset>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-end gap-2">
              <span className="w-72">
                <Select ariaLabel={t("tools.batch.addStep")} value={pendingOperation} options={operationOptions} onChange={(value) => setPendingOperation(value as BatchOperation)} />
              </span>
              <Button icon={<Plus className="size-4" aria-hidden />} onClick={addStep} disabled={running || !canAdd}>
                {t("tools.batch.addStep")}
              </Button>
            </div>
            {!chainValid && steps.length > 0 ? <p className="text-xs text-warning">{t("tools.batch.chainInvalid")}</p> : null}
            <Checkbox label={t("tools.batch.mergeAtEnd")} hint={t("tools.batch.mergeAtEndHint", { name: mergedName })} checked={mergeAtEnd && producesPdf} onChange={setMergeAtEnd} disabled={!producesPdf || running} />
          </Section>

          <Section title={t("tools.batch.savedChains")}>
            {chains.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {chains.map((chain) => (
                  <li key={chain.id} className="glass-chip flex items-center gap-1 rounded-full ps-3 pe-1">
                    <button type="button" onClick={() => loadChain(chain)} disabled={running} className="flex items-center gap-2 py-1.5 text-sm hover:text-primary disabled:pointer-events-none disabled:opacity-50">
                      <Bookmark className="size-3.5 text-(--tone)" aria-hidden />
                      <span>{chain.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{chain.steps.length}</span>
                      {chain.storedSecrets?.length ? (
                        <span title={t("tools.batch.secretsStoredBadge")}>
                          <KeyRound className="size-3.5 text-success" aria-label={t("tools.batch.secretsStoredBadge")} />
                        </span>
                      ) : null}
                    </button>
                    {chain.storedSecrets?.length ? <IconButton icon={ShieldOff} label={`${t("tools.batch.forgetSecrets")}: ${chain.name}`} disabled={running} onClick={() => void forgetSecrets(chain)} /> : null}
                    <IconButton icon={X} label={`${t("tools.batch.deleteChain")}: ${chain.name}`} disabled={running} onClick={() => deleteChain(chain.id)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("tools.batch.noChains")}</p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <span className="w-72">
                <TextInput value={chainName} onChange={(event) => setChainName(event.target.value)} placeholder={t("tools.batch.chainNamePlaceholder")} aria-label={t("tools.batch.chainName")} />
              </span>
              <Button icon={<Save className="size-4" aria-hidden />} onClick={() => void saveChain()} loading={savingChain} disabled={chainName.trim().length === 0 || steps.length === 0}>
                {t("tools.batch.saveChain")}
              </Button>
              <Button variant="ghost" icon={<FileUp className="size-4" aria-hidden />} onClick={() => void importChains()} disabled={running}>
                {t("tools.batch.importChains")}
              </Button>
              <Button variant="ghost" icon={<FileDown className="size-4" aria-hidden />} onClick={() => void exportChains()} disabled={chains.length === 0}>
                {t("tools.batch.exportChains")}
              </Button>
            </div>
            {rememberable ? <Checkbox label={t("tools.batch.rememberSecrets")} hint={t("tools.batch.rememberSecretsHint")} checked={rememberSecrets} onChange={setRememberSecrets} disabled={savingChain} /> : null}
          </Section>

          <Section title={t("tools.batch.output")}>
            <Checkbox label={t("tools.batch.sameFolder")} checked={useSourceFolder} onChange={setUseSourceFolder} disabled={running} />
            {useSourceFolder ? null : <OutputDirField value={outputDir} onChange={setOutputDir} disabled={running} />}
            <Field
              label={t("tools.batch.namePattern")}
              hint={t("tools.batch.namePatternHint")}
              note={
                !templateValid ? (
                  <p className="mt-1.5 text-xs text-destructive">
                    {t("tools.batch.namePatternInvalid")}
                  </p>
                ) : exampleName ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">{t("tools.batch.namePatternExample", { name: exampleName })}</p>
                ) : null
              }
            >
              <TextInput
                value={nameTemplate}
                onChange={(event) => setNameTemplate(event.target.value)}
                placeholder={readOutputPattern()}
                disabled={running}
                aria-invalid={!templateValid || undefined}
                className="w-80 font-mono"
              />
            </Field>
          </Section>
        </>
      }
      result={
        <ResultPanel
          status={status}
          progress={progress}
          error={null}
          numeral={status === "success" ? `${done.length} / ${cancelled ? items.length : done.length + failed.length}` : undefined}
          caption={
            status === "success"
              ? cancelled
                ? t("tools.batch.summaryCancelled", { done: done.length, total: items.length })
                : mergeError
                ? t("tools.batch.mergeFailed", { reason: describeError(t, mergeError) })
                : failed.length > 0
                ? t("tools.batch.summaryWithErrors", { done: done.length, failed: failed.length })
                : mergedOutput
                  ? t("tools.batch.summaryMerged", { count: done.length })
                  : t("tools.batch.summary", { count: done.length })
              : undefined
          }
          outputs={[...(mergedOutput ? [mergedOutput] : []), ...done.flatMap((item) => (item.output ? [item.output] : []))]}
          idleIcon={Layers}
          idleTitle={t("tools.batch.idle.title")}
          idleDescription={t("tools.batch.idle.description")}
          onCancel={cancel}
          overwritePrompt={null}
          onConfirmOverwrite={() => undefined}
          onDismissOverwrite={() => undefined}
        >
          {failed.length > 0 && !running ? (
            <div className="border-b px-4 py-2.5">
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => void run(true)} disabled={!ready}>
                {t("tools.batch.retryFailed", { count: failed.length })}
              </Button>
            </div>
          ) : null}
        </ResultPanel>
      }
    />
  );
}

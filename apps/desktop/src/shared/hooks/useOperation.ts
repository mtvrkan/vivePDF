import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useHistoryStore } from "@/shared/store/historyStore";
import { useOperationStore } from "@/shared/store/operationStore";
import { useSourceChangeStore } from "@/shared/store/sourceChangeStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { revealPath } from "@/shared/lib/reveal";
import { dirnameOf, extensionOf } from "@/shared/lib/paths";
import { openProducedFile } from "@/shared/rpc/files";
import { isNotGranted, toRpcError, type RpcCallOptions } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { OperationStatus, RpcError, RpcProgress } from "@/types";

type Runner<TParams, TResult> = (params: TParams, options: RpcCallOptions) => Promise<TResult>;

type OverwriteParams = { overwrite?: boolean };
type RunOptions = { quiet?: boolean };
export type RefusedOutput = { keys: string[]; path: string; folder: boolean };

async function runAfterOperation(outputs: string[]) {
  const first = outputs[0];
  if (!first) return;
  const { afterOperation } = usePreferencesStore.getState();
  try {
    if (afterOperation === "reveal") await revealPath(first);
    else if (afterOperation === "open") await openProducedFile(first);
  } catch {
    return;
  }
}

function outputsOf(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as { output?: unknown; outputs?: unknown };
  if (typeof record.output === "string") return [record.output];
  if (Array.isArray(record.outputs)) {
    return record.outputs
      .map((item) => (typeof item === "string" ? item : typeof item === "object" && item !== null ? String((item as { output?: unknown; path?: unknown }).output ?? (item as { path?: unknown }).path ?? "") : ""))
      .filter((item) => item.length > 0);
  }
  return [];
}

export function refusedOutput(params: object, error: unknown): RefusedOutput | null {
  if (!isNotGranted(error)) return null;
  const data = toRpcError(error).data;
  const output = data?.output;
  if (typeof output !== "string" || output.length === 0) return null;
  const folder = data?.folder === true;
  const keys = keysHolding(params, output);
  if (keys) return { keys, path: output, folder };
  const parent = folder ? null : keysHolding(params, dirnameOf(output));
  return parent ? { keys: parent, path: dirnameOf(output), folder: true } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysHolding(value: object, text: string): string[] | null {
  for (const [name, item] of Object.entries(value)) {
    if (item === text) return [name];
    const inner = isRecord(item) ? keysHolding(item, text) : null;
    if (inner) return [name, ...inner];
  }
  return null;
}

function withValueAt<T extends object>(value: T, keys: string[], replacement: unknown): T {
  const [first, ...rest] = keys;
  if (first === undefined) return value;
  const current = (value as Record<string, unknown>)[first];
  return { ...value, [first]: rest.length > 0 && isRecord(current) ? withValueAt(current, rest, replacement) : replacement };
}

async function pickOutput({ path, folder }: RefusedOutput): Promise<string | null> {
  try {
    if (folder) {
      const selected = await openDialog({ directory: true, multiple: false, defaultPath: path });
      return typeof selected === "string" ? selected : null;
    }
    const extension = extensionOf(path);
    const selected = await saveDialog({ defaultPath: path, filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined });
    if (!selected) return null;
    return !extension || selected.toLowerCase().endsWith(`.${extension}`) ? selected : `${selected}.${extension}`;
  } catch {
    return null;
  }
}

export function resultOutlivedSource(seenEpoch: number, epoch: number, running: boolean): boolean {
  return epoch !== seenEpoch && !running;
}

export function useOperation<TParams extends OverwriteParams, TResult>(runner: Runner<TParams, TResult>) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const location = useLocation();
  const addHistory = useHistoryStore((state) => state.add);
  const [status, setStatus] = useState<OperationStatus>("idle");
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const [error, setError] = useState<RpcError | null>(null);
  const [overwritePrompt, setOverwritePrompt] = useState<{ params: TParams; path: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(
    (params: TParams, runOptions: RunOptions = {}) => {
      const attempt = async (params: TParams, mayAsk: boolean): Promise<TResult | null> => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setStatus("running");
        useOperationStore.getState().begin();
        setProgress(null);
        setError(null);
        setResult(null);
        setOverwritePrompt(null);
        let refused: RefusedOutput | null = null;
        try {
          const value = await runner(params, {
            signal: controller.signal,
            onProgress: (update) => {
              setProgress(update);
              useOperationStore.getState().report(update.progress);
            },
          });
          setResult(value);
          setStatus("success");
          if (runOptions.quiet) return value;
          const source = (params as { path?: unknown; pathA?: unknown }).path ?? (params as { pathA?: unknown }).pathA;
          const outputs = outputsOf(value);
          addHistory({ tool: location.pathname, source: typeof source === "string" ? source : null, outputs });
          toast("success", t("tools.done"));
          void runAfterOperation(outputs);
          return value;
        } catch (caught) {
          const rpcError = toRpcError(caught);
          if (rpcError.code === "INVALID_PARAMS" && rpcError.data?.exists === true) {
            setStatus("idle");
            setOverwritePrompt({ params, path: String(rpcError.data.path ?? "") });
            return null;
          }
          refused = mayAsk ? refusedOutput(params, caught) : null;
          if (!refused) {
            setError(rpcError);
            setStatus(rpcError.code === "CANCELLED" ? "idle" : "error");
            return null;
          }
          setStatus("idle");
        } finally {
          useOperationStore.getState().end();
          if (controllerRef.current === controller) controllerRef.current = null;
        }
        const picked = await pickOutput(refused);
        if (!picked) return null;
        const retargeted = withValueAt(params, refused.keys, picked);
        return attempt(refused.folder ? retargeted : { ...retargeted, overwrite: true }, false);
      };
      return attempt(params, true);
    },
    [runner, t, toast, addHistory, location.pathname],
  );

  const confirmOverwrite = useCallback(() => {
    if (!overwritePrompt) return;
    const params = { ...overwritePrompt.params, overwrite: true };
    setOverwritePrompt(null);
    void run(params);
  }, [overwritePrompt, run]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(null);
    setResult(null);
    setError(null);
    setOverwritePrompt(null);
  }, []);

  const sourceEpoch = useSourceChangeStore((state) => state.epoch);
  const seenSourceEpoch = useRef(sourceEpoch);
  useEffect(() => {
    const stale = resultOutlivedSource(seenSourceEpoch.current, sourceEpoch, controllerRef.current !== null);
    seenSourceEpoch.current = sourceEpoch;
    if (stale) reset();
  }, [sourceEpoch, reset]);

  return {
    status,
    progress,
    result,
    error,
    overwritePrompt,
    run,
    cancel,
    reset,
    confirmOverwrite,
    dismissOverwrite: () => setOverwritePrompt(null),
    running: status === "running",
  };
}

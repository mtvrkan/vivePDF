import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { chainProblem, readSavedChains, reconcileStoredSecrets, runChain, storedSecretsOf, type ChainContext } from "@/features/tools/batch/chain";
import { releaseWatchTicket, watchTicket } from "@/shared/rpc/chainSecrets";
import { useTauriEvent } from "@/shared/hooks/useTauriEvent";
import { describeError } from "@/shared/lib/errorMessage";
import { basenameOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { listPdfs, moveToFolder } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useWatchStore, type WatchRule } from "@/shared/store/watchStore";
import { normalizePath } from "./pathRelation";
import { createFailureBatcher, createWatchLedger, localLedgerStorage, LEDGER_LIMIT, type WatchFileEvent } from "./watchLedger";
import { createLaneScheduler, watchLane } from "./watchScheduler";
import { catchUpExcludes, insideFolder, sortingFolders, watchSignature } from "./watchFolders";

export const WATCH_RETRY_MS = 15000;
export const CATCH_UP_SETTLE_MS = 5000;

type WatchFolderError = { id: string; message: string };

export function WatchRunner() {
  const { t } = useTranslation();
  const storedRules = useWatchStore((state) => state.rules);
  const pausedAt = useWatchStore((state) => state.pausedAt);
  const rules = useMemo(() => (pausedAt === null ? storedRules : storedRules.map((rule) => (rule.enabled ? { ...rule, enabled: false } : rule))), [storedRules, pausedAt]);
  const logEvent = useWatchStore((state) => state.logEvent);
  const updateRule = useWatchStore((state) => state.update);
  const setProblem = useWatchStore((state) => state.setProblem);
  const pushToast = useToastStore((state) => state.push);
  const [scheduler] = useState(createLaneScheduler);
  const [ledger] = useState(() => createWatchLedger(LEDGER_LIMIT, localLedgerStorage));
  const [retryTick, setRetryTick] = useState(0);
  const activeRef = useRef<Set<string>>(new Set());
  const startedRef = useRef<Map<string, string>>(new Map());
  const catchUpTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const failedRef = useRef<Set<string>>(new Set());
  const abortsRef = useRef<Map<string, AbortController>>(new Map());
  const pendingRef = useRef<Map<string, WatchFileEvent | null>>(new Map());
  const folderErrorsRef = useRef<Set<string>>(new Set());
  const resumeSinceRef = useRef<Map<string, number>>(new Map());
  const previousPauseRef = useRef(pausedAt);
  const rulesRef = useRef<WatchRule[]>(rules);
  rulesRef.current = rules;
  const tRef = useRef(t);
  tRef.current = t;

  const [failures] = useState(() =>
    createFailureBatcher((names) => {
      const translate = tRef.current;
      const message = names.length === 1 ? translate("tools.watch.log.errorToast", { name: names[0] }) : translate("tools.watch.log.errorToastMany", { count: names.length });
      useToastStore.getState().push("error", message);
    }),
  );

  useEffect(() => () => failures.dispose(), [failures]);

  const reportFailure = useCallback(
    (path: string, message: string, ruleId?: string) => {
      logEvent({ id: crypto.randomUUID(), path, status: "error", error: message, at: Date.now(), ruleId });
      failures.add(basenameOf(path));
    },
    [failures, logEvent],
  );

  const controllerFor = useCallback((ruleId: string) => {
    const existing = abortsRef.current.get(ruleId);
    if (existing && !existing.signal.aborted) return existing;
    const created = new AbortController();
    abortsRef.current.set(ruleId, created);
    return created;
  }, []);

  const stopRule = useCallback((ruleId: string) => {
    void invoke("watch_folder_stop", { id: ruleId }).catch(() => undefined);
    activeRef.current.delete(ruleId);
    startedRef.current.delete(ruleId);
    abortsRef.current.get(ruleId)?.abort();
    abortsRef.current.delete(ruleId);
  }, []);

  const handleFile = useRef<(event: WatchFileEvent) => void>(() => undefined);

  const moveSource = async (path: string, folder: string): Promise<{ output?: string; error?: string }> => {
    try {
      const moved = await moveToFolder({ path, folder });
      return { output: moved.output };
    } catch (error) {
      return { error: tRef.current("tools.watch.moveFailed", { reason: describeError(tRef.current, toRpcError(error)) }) };
    }
  };

  const catchUp = async (rule: WatchRule, since?: number) => {
    const sorting = sortingFolders(rule, tRef.current);
    try {
      const listed = await listPdfs({ folder: rule.folder, recursive: rule.recursive, exclude: catchUpExcludes(rule, sorting) });
      const now = Date.now();
      for (const entry of listed?.entries ?? []) {
        if (since !== undefined && entry.modified < since) continue;
        const event: WatchFileEvent = { id: rule.id, path: entry.path, size: entry.size, modified: entry.modified };
        const wait = entry.modified + CATCH_UP_SETTLE_MS - now;
        if (wait <= 0) {
          handleFile.current(event);
          continue;
        }
        const timer = setTimeout(() => {
          catchUpTimersRef.current.delete(timer);
          handleFile.current(event);
        }, Math.min(wait, CATCH_UP_SETTLE_MS));
        catchUpTimersRef.current.add(timer);
      }
    } catch {
      return;
    }
  };

  handleFile.current = (payload: WatchFileEvent) => {
    const rule = rulesRef.current.find((item) => item.id === payload.id);
    if (!rule || !rule.enabled || !rule.outputDir) return;
    const sorting = sortingFolders(rule, t);
    if (sorting && (insideFolder(payload.path, sorting.processed) || insideFolder(payload.path, sorting.failed))) return;
    const key = `${rule.id}|${normalizePath(payload.path)}`;
    if (pendingRef.current.has(key)) {
      pendingRef.current.set(key, payload);
      return;
    }
    if (ledger.alreadyDone(rule.id, payload)) return;
    if (ledger.loops(rule.id, payload.path)) {
      logEvent({ id: crypto.randomUUID(), path: payload.path, status: "cancelled", error: t("tools.watch.loopSkipped"), at: Date.now(), ruleId: rule.id });
      return;
    }
    const chain = rule.chainId ? readSavedChains().find((item) => item.id === rule.chainId) : undefined;
    if (!chain) {
      reportFailure(payload.path, t("tools.watch.missingChain"), rule.id);
      return;
    }
    const stored = storedSecretsOf(chain);
    const problem = chainProblem(chain.steps, stored);
    if (problem) {
      reportFailure(payload.path, t(problem === "needsSecret" ? "tools.watch.chainNeedsSecret" : "tools.watch.invalidChain"), rule.id);
      return;
    }
    pendingRef.current.set(key, null);
    const id = crypto.randomUUID();
    const at = Date.now();
    const path = payload.path;
    logEvent({ id, path, status: "queued", at, ruleId: rule.id });
    const controller = abortsRef.current.get(rule.id);
    scheduler.enqueue(watchLane(rule), async () => {
      const current = rulesRef.current.find((item) => item.id === rule.id);
      try {
        if (!current || !current.enabled || !controller || controller.signal.aborted || !abortsRef.current.has(rule.id)) {
          logEvent({ id, path, status: "cancelled", error: t("tools.watch.log.cancelled"), at });
          return;
        }
        logEvent({ id, path, status: "running", at });
        const context: ChainContext = { numbering: current.numbering ?? 0, taken: new Set(), sequence: 0 };
        let ticket: string | undefined;
        try {
          if (stored.length > 0) ticket = await watchTicket(rule.id, path);
          const vault = ticket ? { chainId: chain.id, ticket, kinds: stored } : undefined;
          const result = await runChain(chain.steps, path, current.outputDir, controller.signal, undefined, undefined, context, { template: chain.nameTemplate }, vault);
          ledger.markDone(rule.id, payload);
          ledger.recordOutput(rule.id, path, result.output);
          if (context.numbering !== (current.numbering ?? 0)) updateRule(rule.id, { numbering: context.numbering });
          const changedMeanwhile = Boolean(pendingRef.current.get(key));
          const moved = sorting && !changedMeanwhile ? await moveSource(path, sorting.processed) : null;
          logEvent({ id, path, status: "done", output: result.output, at, movedTo: moved?.output, error: moved?.error });
        } catch (error) {
          if (controller.signal.aborted) {
            logEvent({ id, path, status: "cancelled", error: t("tools.watch.log.cancelled"), at });
            return;
          }
          const reason = describeError(t, toRpcError(error));
          const moved = sorting ? await moveSource(path, sorting.failed) : null;
          logEvent({ id, path, status: "error", error: moved?.error ? `${reason} · ${moved.error}` : reason, at, movedTo: moved?.output });
          failures.add(basenameOf(path));
        } finally {
          if (ticket) void releaseWatchTicket(ticket);
        }
      } finally {
        const again = pendingRef.current.get(key);
        pendingRef.current.delete(key);
        if (again) handleFile.current(again);
      }
    });
  };

  useEffect(() => {
    void reconcileStoredSecrets().catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setRetryTick((tick) => tick + 1), WATCH_RETRY_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const previous = previousPauseRef.current;
    previousPauseRef.current = pausedAt;
    if (previous === null || pausedAt !== null) return;
    for (const rule of storedRules) {
      if (rule.enabled) resumeSinceRef.current.set(rule.id, previous);
    }
  }, [pausedAt, storedRules]);

  useEffect(() => {
    const active = activeRef.current;
    const failed = failedRef.current;
    const started = startedRef.current;
    const wanted = new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.id));
    for (const rule of rules) {
      if (rule.enabled && active.has(rule.id) && started.get(rule.id) !== watchSignature(rule)) stopRule(rule.id);
      if (!rule.enabled || active.has(rule.id)) continue;
      if (!rule.outputDir) {
        if (!failed.has(rule.id)) {
          failed.add(rule.id);
          setProblem(rule.id, "outputMissing");
          reportFailure(rule.folder, t("tools.watch.outputMissing"), rule.id);
        }
        continue;
      }
      active.add(rule.id);
      started.set(rule.id, watchSignature(rule));
      controllerFor(rule.id);
      void invoke("watch_folder_start", { id: rule.id, path: rule.folder, recursive: rule.recursive, exclude: rule.outputDir, chainId: rule.chainId ?? null })
        .then(() => {
          failed.delete(rule.id);
          folderErrorsRef.current.delete(rule.id);
          setProblem(rule.id, null);
          const since = resumeSinceRef.current.get(rule.id);
          resumeSinceRef.current.delete(rule.id);
          if (rule.catchUp) void catchUp(rule);
          else if (since !== undefined) void catchUp(rule, since);
        })
        .catch((error: unknown) => {
          active.delete(rule.id);
          started.delete(rule.id);
          const rpcError = toRpcError(error);
          const missing = rpcError.code === "FILE_NOT_FOUND";
          setProblem(rule.id, missing ? "folderMissing" : "failed");
          if (failed.has(rule.id)) return;
          failed.add(rule.id);
          reportFailure(rule.folder, missing ? t("tools.watch.folderMissing") : describeError(t, rpcError), rule.id);
        });
    }
    for (const id of Array.from(active)) {
      if (!wanted.has(id)) stopRule(id);
    }
    for (const id of Array.from(abortsRef.current.keys())) {
      if (!wanted.has(id)) stopRule(id);
    }
    for (const id of Array.from(failed)) {
      if (!wanted.has(id)) {
        failed.delete(id);
        setProblem(id, null);
      }
    }
  }, [rules, retryTick, controllerFor, reportFailure, setProblem, stopRule, t]);

  useEffect(() => {
    const active = activeRef.current;
    const aborts = abortsRef.current;
    const timers = catchUpTimersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const id of Array.from(active)) {
        void invoke("watch_folder_stop", { id }).catch(() => undefined);
      }
      for (const controller of aborts.values()) controller.abort();
      active.clear();
      aborts.clear();
    };
  }, []);

  useTauriEvent<WatchFileEvent>("watch-file", (event) => handleFile.current(event.payload));

  useTauriEvent<WatchFileEvent>("watch-file-stalled", (event) => {
    const rule = rulesRef.current.find((item) => item.id === event.payload.id);
    if (!rule || !rule.enabled) return;
    reportFailure(event.payload.path, t("tools.watch.stalledFile"), rule.id);
  });

  useTauriEvent<WatchFileEvent>("watch-folder-lost", (event) => {
    const rule = rulesRef.current.find((item) => item.id === event.payload.id);
    if (!rule || !rule.enabled) return;
    void invoke("watch_folder_stop", { id: rule.id }).catch(() => undefined);
    activeRef.current.delete(rule.id);
    startedRef.current.delete(rule.id);
    failedRef.current.add(rule.id);
    setProblem(rule.id, "folderMissing");
    reportFailure(rule.folder, t("tools.watch.folderLost", { name: basenameOf(rule.folder) || rule.folder }), rule.id);
  });

  useTauriEvent<WatchFolderError>("watch-folder-error", (event) => {
    const rule = rulesRef.current.find((item) => item.id === event.payload.id);
    if (!rule || !rule.enabled || folderErrorsRef.current.has(rule.id)) return;
    folderErrorsRef.current.add(rule.id);
    pushToast("error", t("tools.watch.folderError", { name: basenameOf(rule.folder) || rule.folder, message: event.payload.message }));
  });

  return null;
}

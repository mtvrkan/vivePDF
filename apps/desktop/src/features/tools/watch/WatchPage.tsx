import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, CircleDashed, FolderOpen, FolderSync, Loader2, Pause, Pencil, Play, Plus, Save, Trash2, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Checkbox, Field, Section, TextInput } from "@/components/tool/form";
import { OutputDirField } from "@/components/tool/OutputPathField";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useDropHandler } from "@/shared/hooks/useDropHandler";
import { dirnameOf } from "@/shared/lib/paths";
import { isPdfPath } from "@/shared/rpc/files";
import { basenameOf } from "@/shared/lib/paths";
import { revealPath, RevealError } from "@/shared/lib/reveal";
import { chainProblem, readSavedChains, storedSecretsOf, type ChainProblem } from "@/features/tools/batch/chain";
import { useToastStore } from "@/shared/store/toastStore";
import { cleanFolderName, useWatchStore } from "@/shared/store/watchStore";
import type { WatchLogEntry, WatchLogStatus, WatchRule } from "@/shared/store/watchStore";
import { outputClashes, relationKey, resolvePathRelation, type PathRelation } from "@/features/tools/watch/pathRelation";

const statusIcon: Record<WatchLogStatus, typeof Loader2> = {
  queued: CircleDashed,
  running: Loader2,
  done: CheckCircle2,
  error: XCircle,
  cancelled: Ban,
};

const statusClass: Record<WatchLogStatus, string> = {
  queued: "text-muted-foreground",
  running: "animate-spin text-primary",
  done: "text-success",
  error: "text-destructive",
  cancelled: "text-muted-foreground",
};

const problemKey = {
  folderMissing: "tools.watch.retrying",
  outputMissing: "tools.watch.outputMissing",
  failed: "tools.watch.retrying",
} as const;

type RuleActivity = { done: number; failed: number; pending: number; last: number };

function activityByRule(log: WatchLogEntry[]): Map<string, RuleActivity> {
  const activity = new Map<string, RuleActivity>();
  for (const entry of log) {
    if (!entry.ruleId) continue;
    const current = activity.get(entry.ruleId) ?? { done: 0, failed: 0, pending: 0, last: 0 };
    if (entry.status === "done") current.done += 1;
    else if (entry.status === "error") current.failed += 1;
    else if (entry.status === "queued" || entry.status === "running") current.pending += 1;
    current.last = Math.max(current.last, entry.at);
    activity.set(entry.ruleId, current);
  }
  return activity;
}

function sameFolderName(first: string, second: string): boolean {
  return first.toLocaleLowerCase() === second.toLocaleLowerCase();
}

export function WatchPage() {
  const { t, i18n } = useTranslation();
  const rules = useWatchStore((state) => state.rules);
  const log = useWatchStore((state) => state.log);
  const problems = useWatchStore((state) => state.problems);
  const addRule = useWatchStore((state) => state.add);
  const updateRule = useWatchStore((state) => state.update);
  const removeRule = useWatchStore((state) => state.remove);
  const toggleRule = useWatchStore((state) => state.toggle);
  const clearLog = useWatchStore((state) => state.clearLog);
  const paused = useWatchStore((state) => state.pausedAt !== null);
  const setPaused = useWatchStore((state) => state.setPaused);
  const toast = useToastStore((state) => state.push);
  const handleReveal = async (target: string) => {
    try {
      await revealPath(target);
    } catch (error) {
      const reasonKey = error instanceof RevealError ? error.reasonKey : "errors.revealFailed";
      toast("error", t(reasonKey));
    }
  };

  const [folder, setFolder] = useState("");
  const [chainId, setChainId] = useState<string>("");
  const [outputDir, setOutputDir] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [moveSources, setMoveSources] = useState(false);
  const [processedName, setProcessedName] = useState(() => t("tools.watch.processedDefault"));
  const [failedName, setFailedName] = useState(() => t("tools.watch.failedDefault"));
  const [catchUp, setCatchUp] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState("");
  const [resolvedRelation, setResolvedRelation] = useState<{ key: string; relation: PathRelation } | null>(null);
  const activity = useMemo(() => activityByRule(log), [log]);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }), [i18n.language]);
  const visibleLog = logFilter ? log.filter((entry) => entry.ruleId === logFilter) : log;
  const ruleLabel = (rule: WatchRule) => basenameOf(rule.folder) || rule.folder;

  useEffect(() => {
    if (!folder || !outputDir) return;
    let cancelled = false;
    void resolvePathRelation(outputDir, folder).then((relation) => {
      if (!cancelled) setResolvedRelation({ key: relationKey(folder, outputDir), relation });
    });
    return () => {
      cancelled = true;
    };
  }, [folder, outputDir]);

  const chains = readSavedChains();
  const chainOptions = chains.map((chain) => ({ value: chain.id, label: chain.name }));
  const chainName = (id: string | null) => chains.find((chain) => chain.id === id)?.name ?? t("tools.watch.missingChain");
  const problemOf = (id: string | null): ChainProblem | null => {
    const chain = chains.find((item) => item.id === id);
    return chainProblem(chain?.steps, storedSecretsOf(chain));
  };
  const problemText = (problem: ChainProblem) => t(problem === "needsSecret" ? "tools.watch.chainNeedsSecret" : "tools.watch.invalidChain");
  const selectedProblem = chainId ? problemOf(chainId) : null;

  const outputValid = outputDir.length > 0 && !outputClashes(folder, outputDir, resolvedRelation);
  const cleanProcessed = cleanFolderName(processedName);
  const cleanFailed = cleanFolderName(failedName);
  const sortingValid = !moveSources || (cleanProcessed.length > 0 && cleanFailed.length > 0 && !sameFolderName(cleanProcessed, cleanFailed));
  const ready = folder.length > 0 && chainId.length > 0 && !selectedProblem && outputValid && sortingValid;

  useDropHandler(
    useCallback((paths: string[]) => {
      const dropped = paths[0];
      if (!dropped) return;
      setFolder(isPdfPath(dropped) ? dirnameOf(dropped) : dropped);
    }, []),
  );

  const browseFolder = async () => {
    const selected = await openDialog({ directory: true, multiple: false, defaultPath: folder || undefined });
    if (typeof selected === "string") setFolder(selected);
  };

  const resetForm = () => {
    setEditingId(null);
    setFolder("");
    setChainId("");
    setOutputDir("");
    setRecursive(false);
    setMoveSources(false);
    setProcessedName(t("tools.watch.processedDefault"));
    setFailedName(t("tools.watch.failedDefault"));
    setCatchUp(false);
  };

  const startEditing = (rule: WatchRule) => {
    setEditingId(rule.id);
    setFolder(rule.folder);
    setChainId(rule.chainId ?? "");
    setOutputDir(rule.outputDir);
    setRecursive(rule.recursive);
    setMoveSources(rule.moveSources === true);
    setProcessedName(rule.processedName || t("tools.watch.processedDefault"));
    setFailedName(rule.failedName || t("tools.watch.failedDefault"));
    setCatchUp(rule.catchUp === true);
  };

  const submit = () => {
    if (!ready) return;
    const settings = { folder, chainId, outputDir, recursive, moveSources, processedName: cleanProcessed, failedName: cleanFailed, catchUp };
    if (editingId && rules.some((rule) => rule.id === editingId)) {
      updateRule(editingId, settings);
      toast("success", t("tools.watch.ruleSaved"));
    } else {
      addRule({ id: crypto.randomUUID(), enabled: true, ...settings });
    }
    resetForm();
  };

  return (
    <ToolLayout
      title={t("nav.watch")}
      description={t("tools.watch.description")}
      icon={FolderSync}
      form={
        <>
          <Section title={t("tools.watch.rules")}>
            {rules.some((rule) => rule.enabled) ? (
              <div role="status" className={`mb-2 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm ${paused ? "bg-warning/10 text-warning" : "text-muted-foreground"}`}>
                <span className="min-w-0 flex-1">{paused ? t("tools.watch.pausedBanner") : t("tools.watch.watchingStatus")}</span>
                <Button variant="ghost" size="sm" icon={paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />} onClick={() => setPaused(!paused)}>
                  {paused ? t("tools.watch.resume") : t("tools.watch.pause")}
                </Button>
              </div>
            ) : null}
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("tools.watch.noRules")}</p>
            ) : (
              <ol className="space-y-1.5">
                {rules.map((rule) => {
                  const stats = activity.get(rule.id);
                  return (
                  <li key={rule.id} className={`glass-chip flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${editingId === rule.id ? "ring-2 ring-primary" : ""}`}>
                    <FolderSync className="size-4 shrink-0 text-(--tone)" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" title={rule.folder}>
                        {basenameOf(rule.folder) || rule.folder}
                      </span>
                      <span title={`${chainName(rule.chainId)} · ${t("tools.outputDir")}: ${basenameOf(rule.outputDir) || rule.outputDir}${rule.recursive ? ` · ${t("tools.watch.recursiveBadge")}` : ""}`} className="block truncate text-xs text-muted-foreground">
                        {chainName(rule.chainId)} · {t("tools.outputDir")}: {basenameOf(rule.outputDir) || rule.outputDir}
                        {rule.recursive ? ` · ${t("tools.watch.recursiveBadge")}` : ""}
                        {rule.moveSources ? ` · ${t("tools.watch.moveBadge", { processed: rule.processedName ?? t("tools.watch.processedDefault"), failed: rule.failedName ?? t("tools.watch.failedDefault") })}` : ""}
                        {rule.catchUp ? ` · ${t("tools.watch.catchUpBadge")}` : ""}
                      </span>
                      {stats ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {t("tools.watch.ruleStatus", { done: stats.done, failed: stats.failed, pending: stats.pending })} · {t("tools.watch.lastActivity", { time: timeFormat.format(stats.last) })}
                        </span>
                      ) : null}
                      {rule.chainId && problemOf(rule.chainId) && chains.some((chain) => chain.id === rule.chainId) ? (
                        <span className="block truncate text-xs text-warning">{problemText(problemOf(rule.chainId) as ChainProblem)}</span>
                      ) : null}
                      {rule.enabled && problems[rule.id] ? <span className="block truncate text-xs text-warning">{t(problemKey[problems[rule.id]])}</span> : null}
                    </span>
                    <Checkbox label="" ariaLabel={t("tools.watch.ruleEnabled", { name: ruleLabel(rule) })} checked={rule.enabled} onChange={() => toggleRule(rule.id)} />
                    <IconButton icon={Pencil} label={`${t("tools.watch.editRule")}: ${ruleLabel(rule)}`} onClick={() => startEditing(rule)} />
                    <IconButton
                      icon={Trash2}
                      label={`${t("tools.watch.removeRule")}: ${ruleLabel(rule)}`}
                      onClick={() => {
                        removeRule(rule.id);
                        if (editingId === rule.id) resetForm();
                        if (logFilter === rule.id) setLogFilter("");
                        toast("info", t("tools.watch.ruleRemoved"), { label: t("common.undo"), onClick: () => addRule(rule) });
                      }}
                    />
                  </li>
                  );
                })}
              </ol>
            )}
          </Section>

          <Section title={editingId ? t("tools.watch.editRuleTitle") : t("tools.watch.addRule")}>
            <Field label={t("tools.watch.folder")}>
              <div className="flex gap-2">
                <TextInput value={folder} readOnly className="font-mono text-sm" aria-label={t("tools.watch.folder")} />
                <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void browseFolder()}>
                  {t("tools.browse")}
                </Button>
              </div>
            </Field>
            <Field label={t("tools.watch.chain")}>
              {chains.length === 0 ? (
                <p className="field flex h-row items-center rounded-lg px-3 text-sm text-muted-foreground">
                  {t("tools.watch.noChainsHint")}&nbsp;
                  <Link to="/tools/batch" className="text-primary hover:underline">
                    {t("nav.batch")}
                  </Link>
                </p>
              ) : (
                <Select
                  ariaLabel={t("tools.watch.chain")}
                  value={chainId}
                  options={chainOptions}
                  onChange={setChainId}
                  placeholder={t("tools.watch.chainPlaceholder")}
                />
              )}
            </Field>
            {selectedProblem ? <p className="text-xs text-warning">{problemText(selectedProblem)}</p> : null}
            <OutputDirField value={outputDir} onChange={setOutputDir} />
            {outputDir.length > 0 && !outputValid ? <p className="text-xs text-warning">{t("tools.watch.outputMustDiffer")}</p> : null}
            <Checkbox label={t("tools.watch.recursive")} checked={recursive} onChange={setRecursive} />
            <Checkbox label={t("tools.watch.catchUp")} checked={catchUp} onChange={setCatchUp} />
            <p className="text-xs text-muted-foreground">{t("tools.watch.catchUpHint")}</p>
            <Checkbox label={t("tools.watch.moveSources")} checked={moveSources} onChange={setMoveSources} />
            {moveSources ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("tools.watch.processedFolder")}>
                    <TextInput value={processedName} onChange={(event) => setProcessedName(event.target.value)} maxLength={60} aria-invalid={!sortingValid || undefined} />
                  </Field>
                  <Field label={t("tools.watch.failedFolder")}>
                    <TextInput value={failedName} onChange={(event) => setFailedName(event.target.value)} maxLength={60} aria-invalid={!sortingValid || undefined} />
                  </Field>
                </div>
                <p className={`text-xs ${sortingValid ? "text-muted-foreground" : "text-warning"}`}>{t(sortingValid ? "tools.watch.moveSourcesHint" : "tools.watch.sortingInvalid")}</p>
              </>
            ) : null}
            <div className="flex gap-2">
              <Button icon={editingId ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />} onClick={submit} disabled={!ready}>
                {editingId ? t("tools.watch.saveRule") : t("tools.watch.addRuleAction")}
              </Button>
              {editingId ? (
                <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={resetForm}>
                  {t("common.cancel")}
                </Button>
              ) : null}
            </div>
          </Section>
        </>
      }
      result={
        <aside aria-label={t("tools.resultPanel")} className="glass-flat flex min-h-0 flex-col">
          {log.length === 0 ? (
            <EmptyState icon={FolderSync} title={t("tools.watch.idle.title")} description={t("tools.watch.idle.description")} />
          ) : (
            <div className="flex min-h-0 flex-col">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 pb-3 pt-4">
                <p className="text-sm font-medium">{t("tools.watch.log.title")}</p>
                <div className="flex items-center gap-2">
                  {rules.length > 1 ? (
                    <Select
                      size="sm"
                      ariaLabel={t("tools.watch.log.filter")}
                      value={logFilter}
                      options={[{ value: "", label: t("tools.watch.log.allRules") }, ...rules.map((rule) => ({ value: rule.id, label: ruleLabel(rule) }))]}
                      onChange={setLogFilter}
                    />
                  ) : null}
                  <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={clearLog}>
                    {t("tools.watch.log.clear")}
                  </Button>
                </div>
              </header>
              {visibleLog.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">{t("tools.watch.log.noneForRule")}</p> : null}
              <ul className="min-h-0 overflow-auto">
                {visibleLog.map((entry) => {
                  const Icon = statusIcon[entry.status];
                  return (
                    <li key={entry.id} className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
                      <Icon className={`size-4 shrink-0 ${statusClass[entry.status]}`} aria-hidden />
                      <span className="sr-only">{t(`tools.watch.log.status.${entry.status}`)}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.movedTo ? `${entry.path} → ${entry.movedTo}` : entry.path}>
                        {basenameOf(entry.path)}
                      </span>
                      <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(entry.at).toISOString()}>
                        {timeFormat.format(entry.at)}
                      </time>
                      {entry.interrupted ? <span className="shrink-0 truncate text-xs text-muted-foreground">{t("tools.watch.log.interrupted")}</span> : null}
                      {entry.error && !entry.interrupted ? (
                        <span className={`shrink-0 truncate text-xs ${entry.status === "error" ? "text-destructive" : entry.status === "done" ? "text-warning" : "text-muted-foreground"}`} title={entry.error}>
                          {entry.error}
                        </span>
                      ) : null}
                      {entry.movedTo ? (
                        <IconButton icon={FolderSync} label={`${t("tools.watch.log.revealSource")}: ${basenameOf(entry.movedTo)}`} onClick={() => void handleReveal(entry.movedTo as string)} />
                      ) : null}
                      {entry.status === "done" && entry.output ? (
                        <span className="max-w-1/2 shrink-0 truncate font-mono text-xs text-muted-foreground" title={entry.output}>
                          {basenameOf(entry.output)}
                        </span>
                      ) : null}
                      {entry.status === "done" && entry.output ? (
                        <IconButton icon={FolderOpen} label={t("tools.reveal")} onClick={() => void handleReveal(entry.output as string)} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>
      }
    />
  );
}

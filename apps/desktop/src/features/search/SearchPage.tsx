import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CalendarDays, Clock, FileSearch, FileText, FolderOpen, FolderPlus, FolderSearch, Hash, HelpCircle, Lightbulb, Loader2, RefreshCw, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { cn } from "@/shared/lib/cn";
import { EmptyState } from "@/components/shared/EmptyState";
import { IconButton } from "@/components/shared/IconButton";
import { PageHeader } from "@/components/shared/PageHeader";
import { Select } from "@/components/shared/Select";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf } from "@/shared/lib/paths";
import { RevealError, revealPath } from "@/shared/lib/reveal";
import { toRpcError } from "@/shared/rpc/client";
import { searchAddFolder, searchFolders, searchIndex, searchQuery, searchRemoveFolder } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useSearchRequestStore } from "@/shared/store/searchRequestStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerJumpStore } from "@/shared/store/viewerJumpStore";
import type { RpcError, RpcProgress, SearchFolder, SearchIndexStats, SearchQueryResult } from "@/types";
import { buildQueryParams, clearHistory, isIndexStale, latestIndexedAt, pushHistory, readHistory, removeFromHistory, splitSnippet } from "./searchUtils";

const QUERY_DELAY_MS = 250;
const HISTORY_SETTLE_MS = 3000;

const SEARCH_TIPS = [
  { key: "tipPhrase", example: '"..."' },
  { key: "tipPrefix", example: "kelime*" },
  { key: "tipOr", example: "a OR b" },
  { key: "tipExclude", example: "-kelime" },
  { key: "tipNear", example: "NEAR(a b, 5)" },
] as const;

function renderSnippet(snippet: string): ReactNode[] {
  return splitSnippet(snippet).map((part, index) =>
    part.matched ? (
      <mark key={index} className="rounded-sm bg-primary/25 px-0.5 text-foreground">
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

function FilterGroup({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg px-2.5">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      {children}
    </div>
  );
}

function FilterDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

const HELP_PANEL_WIDTH = 288;
const HELP_PANEL_GAP = 6;
const HELP_PANEL_EDGE = 8;

function SyntaxHelpPopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(Math.max(rect.right - HELP_PANEL_WIDTH, HELP_PANEL_EDGE), window.innerWidth - HELP_PANEL_WIDTH - HELP_PANEL_EDGE);
      setAnchor({ top: rect.bottom + HELP_PANEL_GAP, left });
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("search.syntaxHelp")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className="nav-glass inline-flex size-8 items-center justify-center rounded-lg text-foreground/80 hover:text-foreground"
      >
        <HelpCircle className="size-4" aria-hidden />
      </button>
      {open && anchor
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={t("search.syntaxHelp")}
              className="glass-menu fixed z-50 rounded-xl p-3 text-xs leading-snug text-foreground/85"
              style={{ top: anchor.top, left: anchor.left, width: HELP_PANEL_WIDTH }}
            >
              {t("search.syntaxHelpText")}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function SearchPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const { openPath } = useOpenPdf();
  const activeDocument = useDocumentStore((state) => (state.activeId ? (state.documents[state.activeId] ?? null) : null));
  const [folders, setFolders] = useState<SearchFolder[]>([]);
  const [folderFilter, setFolderFilter] = useState("all");
  const [modifiedAfter, setModifiedAfter] = useState("");
  const [modifiedBefore, setModifiedBefore] = useState("");
  const [minPages, setMinPages] = useState("");
  const [maxPages, setMaxPages] = useState("");
  const [docOnly, setDocOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchQueryResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const [stats, setStats] = useState<SearchIndexStats | null>(null);
  const [lastIndexed, setLastIndexed] = useState<number | null>(null);
  const [error, setError] = useState<RpcError | null>(null);
  const [history, setHistory] = useState<string[]>(() => readHistory());
  const [historyFocused, setHistoryFocused] = useState(false);
  const timerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const settleRef = useRef<number | null>(null);
  const requestNonce = useSearchRequestStore((state) => state.nonce);

  const runIndex = useCallback(async (path?: string, force?: boolean) => {
    setIndexing(true);
    setError(null);
    try {
      const outcome = await searchIndex(path ? { path, force } : { force }, { onProgress: setProgress });
      setFolders(outcome.folders);
      setStats(outcome.stats);
      setLastIndexed(latestIndexedAt(outcome.folders));
    } catch (caught) {
      setError(toRpcError(caught));
    } finally {
      setIndexing(false);
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    searchFolders()
      .then((listed) => {
        if (cancelled) return;
        setFolders(listed.folders);
        const newest = latestIndexedAt(listed.folders);
        setLastIndexed(newest);
        const stale = isIndexStale(newest, Date.now() / 1000);
        if (listed.folders.length > 0 && stale && usePreferencesStore.getState().searchAutoIndex) void runIndex();
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toRpcError(caught));
      });
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [runIndex]);

  const recordQuery = useCallback((value: string) => {
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = null;
    setHistory(pushHistory(value));
  }, []);

  const runQuery = useCallback(
    (value: string) => {
      if (!value.trim()) {
        setResult(null);
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const requestId = ++requestIdRef.current;
      setSearching(true);
      setError(null);
      searchQuery(
        buildQueryParams({
          query: value,
          folder: folderFilter,
          documentPath: docOnly && activeDocument ? activeDocument.path : null,
          modifiedAfter,
          modifiedBefore,
          minPages,
          maxPages,
        }),
        { signal: controller.signal },
      )
        .then((outcome) => {
          if (requestIdRef.current !== requestId) return;
          setResult(outcome);
          if (settleRef.current !== null) window.clearTimeout(settleRef.current);
          settleRef.current = window.setTimeout(() => recordQuery(value), HISTORY_SETTLE_MS);
        })
        .catch((caught: unknown) => {
          if (requestIdRef.current !== requestId) return;
          const rpcError = toRpcError(caught);
          if (rpcError.code !== "CANCELLED") setError(rpcError);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setSearching(false);
        });
    },
    [folderFilter, docOnly, activeDocument, modifiedAfter, modifiedBefore, minPages, maxPages, recordQuery],
  );

  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (settleRef.current !== null) {
      window.clearTimeout(settleRef.current);
      settleRef.current = null;
    }
    if (!query.trim()) {
      setResult(null);
      controllerRef.current?.abort();
      return;
    }
    timerRef.current = window.setTimeout(() => runQuery(query), QUERY_DELAY_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [query, runQuery]);

  useEffect(() => {
    if (requestNonce === 0) return;
    const requested = useSearchRequestStore.getState().query;
    setQuery(requested);
    inputRef.current?.focus();
  }, [requestNonce]);

  const addFolder = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    setIndexing(true);
    setError(null);
    try {
      const outcome = await searchAddFolder({ path: selected, recursive: true }, { onProgress: setProgress });
      setFolders(outcome.folders);
      setStats(outcome.stats);
    } catch (caught) {
      const rpcError = toRpcError(caught);
      toast("error", rpcError.data?.reason === "overlap" ? t("search.overlap") : rpcError.message);
    } finally {
      setIndexing(false);
      setProgress(null);
    }
  };

  const removeFolder = async (path: string) => {
    try {
      const listed = await searchRemoveFolder({ path });
      setFolders(listed.folders);
      setLastIndexed(latestIndexedAt(listed.folders));
      if (listed.folders.length === 0) setResult(null);
      if (folderFilter === path) setFolderFilter("all");
      if (query.trim()) runQuery(query);
    } catch (caught) {
      toast("error", toRpcError(caught).message);
    }
  };

  const cancelSearch = () => {
    controllerRef.current?.abort();
    setSearching(false);
  };

  const openHit = (path: string, page: number) => {
    if (query.trim()) recordQuery(query);
    useViewerJumpStore.getState().request({ path, page, query: query.trim() || undefined });
    void openPath(path);
  };

  const revealHit = async (path: string) => {
    try {
      await revealPath(path);
    } catch (caught) {
      const reasonKey = caught instanceof RevealError ? caught.reasonKey : "errors.revealFailed";
      toast("error", t(reasonKey));
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (query.trim()) {
        recordQuery(query);
        runQuery(query);
      }
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
  };

  const matchedPages = result ? result.files.reduce((sum, file) => sum + file.pageHits, 0) : 0;

  const folderOptions = useMemo(
    () => [{ value: "all", label: t("search.allFolders") }, ...folders.map((folder) => ({ value: folder.path, label: basenameOf(folder.path) || folder.path }))],
    [folders, t],
  );

  const totalFiles = folders.reduce((sum, folder) => sum + folder.files, 0);
  const totalPages = folders.reduce((sum, folder) => sum + folder.pages, 0);
  const showHistory = historyFocused && !query.trim() && history.length > 0;

  const hasFilters = folderFilter !== "all" || modifiedAfter !== "" || modifiedBefore !== "" || minPages !== "" || maxPages !== "" || docOnly;
  const clearFilters = () => {
    setFolderFilter("all");
    setModifiedAfter("");
    setModifiedBefore("");
    setMinPages("");
    setMaxPages("");
    setDocOnly(false);
  };
  const applyTip = (example: string) => {
    setQuery(example);
    inputRef.current?.focus();
  };
  const idle = !result && !searching && !query.trim();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("nav.search")} description={t("search.description")} icon={Search} eyebrow={t("nav.workspace")} />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-6 px-4 pb-6 pt-6 md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-1 md:px-6">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="relative">
            <label className={cn("glass flex h-14 items-center gap-3 rounded-2xl px-5 transition-[box-shadow] duration-(--transition-fast) focus-within:ring-2 focus-within:ring-ring/40", folders.length === 0 && "opacity-70")}>
              {searching ? <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden /> : <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                onFocus={() => setHistoryFocused(true)}
                onBlur={() => window.setTimeout(() => setHistoryFocused(false), 150)}
                placeholder={folders.length === 0 ? t("search.noFoldersHint") : t("search.placeholder")}
                disabled={folders.length === 0}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                aria-label={t("nav.search")}
              />
              {searching ? <IconButton icon={X} label={t("search.cancel")} onClick={cancelSearch} /> : null}
              {query ? <IconButton icon={X} label={t("common.close")} onClick={() => setQuery("")} /> : null}
              <SyntaxHelpPopover />
            </label>
            {showHistory ? (
              <ul className="glass-menu absolute inset-x-0 top-full z-10 mt-1.5 max-h-56 overflow-auto rounded-xl p-1.5">
                {history.map((item) => (
                  <li key={item} className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-(--hover-bg)">
                    <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <button type="button" className="min-w-0 flex-1 truncate text-start" onMouseDown={() => setQuery(item)}>
                      {item}
                    </button>
                    <IconButton
                      icon={X}
                      label={t("search.removeHistory")}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setHistory(removeFromHistory(item));
                      }}
                    />
                  </li>
                ))}
                <li className="mt-1 border-t pt-1">
                  <button type="button" onMouseDown={(event) => { event.preventDefault(); setHistory(clearHistory()); }} className="flex h-8 w-full items-center justify-center rounded-lg text-xs text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
                    {t("search.clearHistory")}
                  </button>
                </li>
              </ul>
            ) : null}
          </div>

          <div className="glass-flat flex flex-wrap items-center gap-0.5 rounded-xl border p-1">
            <FilterGroup icon={FolderOpen} label={t("search.filterFolder")}>
              <Select value={folderFilter} options={folderOptions} onChange={setFolderFilter} size="sm" className="w-44" ariaLabel={t("search.folders")} />
            </FilterGroup>
            <FilterDivider />
            <FilterGroup icon={CalendarDays} label={t("search.filterDate")}>
              <DateRangePicker
                start={modifiedAfter}
                end={modifiedBefore}
                onChange={(from, to) => {
                  setModifiedAfter(from);
                  setModifiedBefore(to);
                }}
                ariaLabel={t("search.filterDate")}
              />
            </FilterGroup>
            <FilterDivider />
            <FilterGroup icon={Hash} label={t("search.filterPages")}>
              <input type="number" min={0} value={minPages} onChange={(event) => setMinPages(event.target.value)} placeholder={t("search.minShort")} aria-label={t("search.minPages")} className="field h-7 w-20 rounded-md px-2 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground" />
              <span aria-hidden className="text-xs text-muted-foreground">–</span>
              <input type="number" min={0} value={maxPages} onChange={(event) => setMaxPages(event.target.value)} placeholder={t("search.maxShort")} aria-label={t("search.maxPages")} className="field h-7 w-20 rounded-md px-2 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground" />
            </FilterGroup>
            {activeDocument ? (
              <>
                <FilterDivider />
                <button
                  type="button"
                  role="switch"
                  aria-checked={docOnly}
                  onClick={() => setDocOnly((value) => !value)}
                  className={cn("flex h-7 max-w-64 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors duration-(--transition-fast)", docOnly ? "menubar-active font-medium text-foreground" : "text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground")}
                >
                  <FileText className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{t("search.thisDocumentOnly", { file: activeDocument.fileName })}</span>
                </button>
              </>
            ) : null}
            {hasFilters ? (
              <button type="button" onClick={clearFilters} className="ms-auto flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
                <X className="size-3.5" aria-hidden />
                {t("search.clearFilters")}
              </button>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {describeError(t, error)}
            </p>
          ) : null}

          {idle ? (
            <div className="glass flex min-h-0 flex-1 flex-col rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <span className="tone-tile flex size-12 shrink-0 items-center justify-center rounded-2xl">
                  <FileSearch className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">{t("search.idleTitle")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{folders.length > 0 ? t("search.idleDescription", { files: formatNumber(totalFiles, locale), pages: formatNumber(totalPages, locale) }) : t("search.noFolders")}</p>
                  {folders.length === 0 ? (
                    <Button size="sm" className="mt-3" icon={<FolderPlus className="size-4" aria-hidden />} onClick={() => void addFolder()} disabled={indexing}>
                      {t("search.addFolder")}
                    </Button>
                  ) : null}
                </div>
              </div>
              {history.length > 0 ? (
                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("search.recentSearches")}</p>
                    <button type="button" onClick={() => setHistory(clearHistory())} className="flex min-h-6 items-center rounded-full px-2 text-xs text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
                      {t("search.clearHistory")}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {history.map((item) => (
                      <button key={item} type="button" onClick={() => applyTip(item)} className="glass-chip flex h-8 max-w-64 items-center gap-1.5 rounded-full px-3 text-xs text-foreground/80 transition-colors duration-(--transition-fast) hover:text-foreground">
                        <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{item}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-6 border-t pt-5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <Lightbulb className="size-3.5" aria-hidden />
                  {t("search.tips")}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {SEARCH_TIPS.map((tip) => (
                    <button
                      key={tip.key}
                      type="button"
                      onClick={() => applyTip(tip.example)}
                      className="flex items-center justify-between gap-3 rounded-xl border border-(--glass-border) bg-card/40 px-3 py-2.5 text-start text-sm outline-none transition-colors duration-(--transition-fast) hover:bg-(--hover-bg) focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 truncate">{t(`search.${tip.key}`)}</span>
                      <code className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{tip.example}</code>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{t("search.hint")}</p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <p className="flex flex-wrap items-center gap-x-2 px-1 text-xs text-muted-foreground">
                {result && result.totalFiles > 0 ? (
                  <>
                    <span>{t("search.summary", { files: formatNumber(result.totalFiles, locale), hits: formatNumber(matchedPages, locale) })}</span>
                    {result.totalFiles > result.files.length ? <span>· {t("search.limited", { shown: formatNumber(result.files.length, locale) })}</span> : null}
                  </>
                ) : result ? null : (
                  t("search.hint")
                )}
              </p>
              <div className="min-h-0 flex-1 overflow-auto">
                {result && result.files.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-12 text-center shadow-(--shadow-card)">
                    <span className="tone-tile flex size-11 items-center justify-center rounded-2xl">
                      <Search className="size-5" aria-hidden />
                    </span>
                    <p className="text-sm text-muted-foreground">{t("search.noResults")}</p>
                  </div>
                ) : null}
                <ul className="flex flex-col gap-3">
                  {result?.files.map((file) => (
                    <li key={file.path} className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => openHit(file.path, file.matchedPages[0]?.page ?? 1)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="tone-tile flex size-9 shrink-0 items-center justify-center rounded-xl">
                            <FileText className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span title={file.title || basenameOf(file.path)} className="block truncate text-sm font-semibold">{file.title || basenameOf(file.path)}</span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground" title={file.path}>{file.path}</span>
                          </span>
                        </button>
                        <IconButton icon={FolderSearch} label={t("tools.reveal")} className="shrink-0" onClick={() => void revealHit(file.path)} />
                        <span className="glass-chip shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                          {formatNumber(file.pages, locale)} {t("info.pages")}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-px">
                        {file.matchedPages.map((hit, index) => (
                          <li key={`${hit.page}-${index}`}>
                            <button
                              type="button"
                              onClick={() => openHit(file.path, hit.page)}
                              className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-start text-sm outline-none transition-colors duration-(--transition-fast) hover:bg-(--hover-bg) focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="mt-0.5 shrink-0 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">{t("search.page", { page: hit.page })}</span>
                              <span className="min-w-0 flex-1 leading-snug text-foreground/85">{renderSnippet(hit.snippet)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {file.pageHits > file.matchedPages.length ? (
                        <p className="ps-2.5 text-xs text-muted-foreground">{t("search.moreHits", { count: file.pageHits - file.matchedPages.length })}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <aside className="glass flex min-h-0 flex-col gap-3 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("search.folders")}</h2>
            <span className="font-mono text-[11px] text-muted-foreground">{t("search.indexed", { files: formatNumber(totalFiles, locale), pages: formatNumber(totalPages, locale) })}</span>
          </div>
          {folders.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={t("search.noFoldersTitle")}
              description={t("search.noFolders")}
              action={
                <Button size="sm" icon={<FolderPlus className="size-4" aria-hidden />} onClick={() => void addFolder()} disabled={indexing}>
                  {t("search.addFolder")}
                </Button>
              }
            />
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
              {folders.map((folder) => (
                <li key={folder.path} className="glass-chip flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm">
                  <span className="tone-tile flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <FolderOpen className="size-4" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium" title={folder.path}>
                      {basenameOf(folder.path) || folder.path}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {t("search.indexed", { files: formatNumber(folder.files, locale), pages: formatNumber(folder.pages, locale) })}
                    </span>
                  </span>
                  <IconButton icon={X} label={t("search.remove")} disabled={indexing} onClick={() => void removeFolder(folder.path)} />
                </li>
              ))}
            </ul>
          )}
          {indexing ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
              {progress?.detail ? t("search.indexing", { current: progress.detail.current, total: progress.detail.total }) : t("search.indexingStart")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {stats ? t("search.stats", stats) : null}
              {lastIndexed ? `${stats ? " · " : ""}${t("search.lastIndexed", { when: new Date(lastIndexed * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })}` : null}
            </p>
          )}
          {folders.length > 0 ? (
            <div className="flex gap-2">
              <Button className="flex-1" icon={<FolderPlus className="size-4" aria-hidden />} onClick={() => void addFolder()} disabled={indexing}>
                {t("search.addFolder")}
              </Button>
              <Button className="flex-1" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => void runIndex(undefined, true)} disabled={indexing}>
                {t("search.reindex")}
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

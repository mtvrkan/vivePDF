import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { CornerDownLeft, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  buildActionEntries,
  buildDocumentEntries,
  buildDocumentQueryEntries,
  buildPageEntries,
  buildRecentEntries,
  buildSettingsEntries,
  buildToolEntries,
  type PaletteEntry,
  type PaletteEntryKind,
} from "@/components/layout/paletteEntries";
import { detectPaletteMode, highlightRanges, scoreEntry } from "@/components/layout/paletteMatch";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { useDocumentWindow } from "@/features/viewer/useDocumentWindow";
import { useCloseDocuments } from "@/features/viewer/useCloseDocuments";
import { useModalFocus } from "@/shared/hooks/useModalFocus";
import { cn } from "@/shared/lib/cn";
import { RevealError, revealPath } from "@/shared/lib/reveal";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePaletteStore } from "@/shared/store/paletteStore";
import { useHomeLayoutStore } from "@/features/home/homeLayoutStore";
import { usePrintDialogStore } from "@/shared/store/printDialogStore";
import { useRecentStore } from "@/shared/store/recentStore";
import { useReportStore } from "@/shared/store/reportStore";
import { useSearchRequestStore } from "@/shared/store/searchRequestStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useUpdateStore } from "@/shared/store/updateStore";
import { useViewerJumpStore } from "@/shared/store/viewerJumpStore";
import { readSession } from "@/shared/session/sessionStore";
import { useRestoreSession } from "@/shared/session/useRestoreSession";
import { shortcutLabel } from "@/shared/lib/platform";

const MAX_RESULTS = 40;
const PAGE_STEP = 5;
const PREFIX_HINTS = [
  { prefix: ">", labelKey: "palette.hint.actions" },
  { prefix: "/", labelKey: "palette.hint.pages" },
  { prefix: "@", labelKey: "palette.hint.documents" },
  { prefix: "#", labelKey: "palette.hint.page" },
] as const;

function stripPrefix(label: string): string {
  return label.replace(/^[>/@#]\s*/, "");
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground">{shortcutLabel(children)}</kbd>;
}

type Group = { key: string; label: string; entries: PaletteEntry[] };

function groupLabelFor(t: ReturnType<typeof useTranslation>["t"], kind: PaletteEntryKind): string {
  switch (kind) {
    case "tool":
      return t("palette.group.tools");
    case "page":
      return t("palette.group.pages");
    case "settings":
      return t("palette.group.settings");
    case "action":
      return t("palette.group.actions");
    case "document":
      return t("palette.group.documents");
    case "recent":
      return t("palette.group.recentFiles");
    default:
      return t("palette.group.document");
  }
}

function groupByKind(entries: PaletteEntry[], t: ReturnType<typeof useTranslation>["t"]): Group[] {
  const order: PaletteEntryKind[] = [];
  const map = new Map<PaletteEntryKind, PaletteEntry[]>();
  for (const entry of entries) {
    if (!map.has(entry.kind)) {
      map.set(entry.kind, []);
      order.push(entry.kind);
    }
    map.get(entry.kind)?.push(entry);
  }
  return order.map((kind) => ({ key: kind, label: groupLabelFor(t, kind), entries: map.get(kind) ?? [] }));
}

function scoredSort(entries: PaletteEntry[], needle: string, locale: string, recentIds: string[]): PaletteEntry[] {
  return entries
    .map((entry) => ({
      entry,
      score: scoreEntry(needle, { title: entry.title, subtitle: entry.subtitle, keywords: entry.keywords }, locale),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ai = recentIds.indexOf(a.entry.id);
      const bi = recentIds.indexOf(b.entry.id);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    })
    .map((item) => item.entry);
}

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pickAndOpen, openClipboard, openPath, activate } = useOpenPdf();
  const openWindow = useDocumentWindow();
  const { closeDocuments } = useCloseDocuments();
  const restoreSessionFn = useRestoreSession();
  const toast = useToastStore((state) => state.push);
  const locale = useUiStore((state) => state.locale);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const isOpen = usePaletteStore((state) => state.isOpen);
  const close = usePaletteStore((state) => state.close);
  const toggle = usePaletteStore((state) => state.toggle);
  const consumePendingQuery = usePaletteStore((state) => state.consumePendingQuery);
  const recentIds = usePaletteStore((state) => state.recentIds);
  const recordUse = usePaletteStore((state) => state.recordUse);
  const recent = useRecentStore((state) => state.items);
  const documents = useDocumentStore((state) => state.documents);
  const activeId = useDocumentStore((state) => state.activeId);
  const activeDocument = activeId ? (documents[activeId] ?? null) : null;

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  useModalFocus(panelRef, isOpen, { initialFocus: "none", trapTab: false });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  useEffect(() => {
    if (!isOpen) return;
    const preset = consumePendingQuery();
    setQuery(preset);
    setCursor(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, consumePendingQuery]);

  const go = useCallback((route: string) => void navigate(route), [navigate]);

  const toolEntries = useMemo(() => buildToolEntries(t, go), [t, go]);
  const pageEntries = useMemo(() => buildPageEntries(t, go), [t, go]);
  const settingsEntries = useMemo(() => buildSettingsEntries(t, go), [t, go]);

  const sessionSnapshot = useMemo(() => (isOpen ? readSession() : null), [isOpen]);

  const documentEntries = useMemo(
    () => buildDocumentEntries(t, Object.values(documents), activeId, activate, (id) => closeDocuments([id])),
    [t, documents, activeId, activate, closeDocuments],
  );

  const handleReveal = useCallback(
    (path: string) => {
      void revealPath(path).catch((error: unknown) => {
        const reasonKey = error instanceof RevealError ? error.reasonKey : "errors.revealFailed";
        toast("error", t(reasonKey));
      });
    },
    [toast, t],
  );

  const recentFileEntries = useMemo(
    () => buildRecentEntries(t, recent, (path) => void openPath(path), handleReveal),
    [t, recent, openPath, handleReveal],
  );

  const actionEntries = useMemo(
    () =>
      buildActionEntries(t, {
        pickAndOpen: () => void pickAndOpen(),
        openClipboard: () => void openClipboard(),
        openWindow: () => void openWindow(),
        goToSearch: () => void navigate("/search"),
        hasSession: sessionSnapshot !== null,
        restoreSession: () => {
          if (sessionSnapshot) void restoreSessionFn(sessionSnapshot);
        },
        theme,
        setTheme,
        checkUpdates: () => void useUpdateStore.getState().check(true),
        openReportBug: () => useReportStore.getState().openDialog({ category: "bug" }),
        openSuggestFeature: () => useReportStore.getState().openDialog({ category: "idea" }),
        openLogDir: () => void invoke("open_log_dir"),
        hasActiveDocument: activeDocument !== null,
        openPrint: () => {
          void navigate("/viewer");
          usePrintDialogStore.getState().setOpen(true);
        },
        editHome: () => {
          useHomeLayoutStore.getState().setEditing(true);
          void navigate("/");
        },
      }),
    [t, pickAndOpen, openClipboard, openWindow, navigate, sessionSnapshot, restoreSessionFn, theme, setTheme, activeDocument],
  );

  const { mode, rest } = useMemo(() => detectPaletteMode(query), [query]);

  const documentQueryEntries = useMemo(
    () =>
      mode === null
        ? buildDocumentQueryEntries(t, query, {
            activeDocument,
            requestSearchInDocument: (value) => {
              void navigate("/viewer");
              useSearchRequestStore.getState().requestSearch(value);
            },
            requestPageJump: (path, page) => {
              void navigate("/viewer");
              useViewerJumpStore.getState().request({ path, page });
            },
          })
        : [],
    [mode, t, query, activeDocument, navigate],
  );

  const pageJumpEntries = useMemo(
    () =>
      mode === "page"
        ? buildDocumentQueryEntries(t, rest, {
            activeDocument,
            requestSearchInDocument: () => undefined,
            requestPageJump: (path, page) => {
              void navigate("/viewer");
              useViewerJumpStore.getState().request({ path, page });
            },
          }).filter((entry) => entry.kind === "page-jump")
        : [],
    [mode, t, rest, activeDocument, navigate],
  );

  const defaultGroups = useMemo<Group[]>(() => {
    const allById = new Map<string, PaletteEntry>();
    for (const entry of [...toolEntries, ...pageEntries, ...settingsEntries, ...actionEntries, ...documentEntries, ...recentFileEntries]) {
      allById.set(entry.id, entry);
    }
    const recentCommandEntries = recentIds.map((id) => allById.get(id)).filter((entry): entry is PaletteEntry => Boolean(entry));
    const groups: Group[] = [
      { key: "recentCommands", label: t("palette.group.recentCommands"), entries: recentCommandEntries },
      { key: "openDocuments", label: t("palette.group.documents"), entries: documentEntries },
      { key: "recentFiles", label: t("palette.group.recentFiles"), entries: recentFileEntries.slice(0, 4) },
      { key: "suggested", label: t("palette.group.suggested"), entries: toolEntries.slice(0, 6) },
    ];
    return groups.filter((group) => group.entries.length > 0);
  }, [t, toolEntries, pageEntries, settingsEntries, actionEntries, documentEntries, recentFileEntries, recentIds]);

  const groups = useMemo<Group[]>(() => {
    if (mode === "page") {
      return pageJumpEntries.length > 0 ? [{ key: "page", label: t("palette.group.document"), entries: pageJumpEntries }] : [];
    }
    let pool: PaletteEntry[];
    if (mode === "actions") pool = actionEntries;
    else if (mode === "pages") pool = [...pageEntries, ...settingsEntries];
    else if (mode === "documents") pool = [...documentEntries, ...recentFileEntries];
    else pool = [...toolEntries, ...pageEntries, ...settingsEntries, ...actionEntries, ...documentEntries, ...recentFileEntries, ...documentQueryEntries];

    if (!rest.trim()) {
      if (mode === null) return defaultGroups;
      return groupByKind(pool.slice(0, MAX_RESULTS), t);
    }
    return groupByKind(scoredSort(pool, rest, locale, recentIds).slice(0, MAX_RESULTS), t);
  }, [
    mode,
    rest,
    actionEntries,
    pageEntries,
    settingsEntries,
    documentEntries,
    recentFileEntries,
    toolEntries,
    documentQueryEntries,
    pageJumpEntries,
    defaultGroups,
    locale,
    recentIds,
    t,
  ]);

  const flatResults = useMemo(() => groups.flatMap((group) => group.entries), [groups]);

  const groupBoundaries = useMemo(() => {
    let offset = 0;
    return groups.map((group) => {
      const start = offset;
      offset += group.entries.length;
      return start;
    });
  }, [groups]);

  useEffect(() => {
    setCursor(0);
  }, [query, mode]);

  useEffect(() => {
    const element = listRef.current?.querySelectorAll('[role="option"]')[cursor] as HTMLElement | undefined;
    element?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const runPrimary = useCallback(
    (entry: PaletteEntry) => {
      recordUse(entry.id);
      entry.run();
      close();
    },
    [recordUse, close],
  );

  const runSecondary = useCallback(
    (entry: PaletteEntry) => {
      if (!entry.secondaryRun) return;
      recordUse(entry.id);
      entry.secondaryRun();
      close();
    },
    [recordUse, close],
  );

  if (!isOpen) return null;

  const activeEntry = flatResults[cursor];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (mode !== null && query !== "") setQuery("");
      else close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(flatResults.length - 1, value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(0, value - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setCursor(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setCursor(Math.max(0, flatResults.length - 1));
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setCursor((value) => Math.min(flatResults.length - 1, value + PAGE_STEP));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setCursor((value) => Math.max(0, value - PAGE_STEP));
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (groupBoundaries.length < 2) return;
      let currentGroupIndex = 0;
      for (let i = 0; i < groupBoundaries.length; i += 1) {
        if (cursor >= groupBoundaries[i]) currentGroupIndex = i;
      }
      const nextGroupIndex = (currentGroupIndex + 1) % groupBoundaries.length;
      setCursor(groupBoundaries[nextGroupIndex]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!activeEntry) return;
      if ((event.ctrlKey || event.metaKey) && activeEntry.secondaryRun) runSecondary(activeEntry);
      else runPrimary(activeEntry);
    }
  };

  const modeChipLabel =
    mode === "actions"
      ? t("palette.modeChip.actions")
      : mode === "pages"
        ? t("palette.modeChip.pages")
        : mode === "documents"
          ? t("palette.modeChip.documents")
          : mode === "page"
            ? t("palette.modeChip.page")
            : null;

  let globalIndex = -1;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-(--overlay) pt-[12vh] backdrop-blur-sm" onMouseDown={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex max-h-[min(40rem,76vh)] w-[38rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-(--shadow-float)"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 px-4">
          <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
          {modeChipLabel ? <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{modeChipLabel}</span> : null}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.title")}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeEntry ? `${listboxId}-${cursor}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <Kbd>Esc</Kbd>
        </div>
        {query === "" ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t px-3 py-2">
            {PREFIX_HINTS.map((hint) => (
              <button
                key={hint.prefix}
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setQuery(hint.prefix);
                  inputRef.current?.focus();
                }}
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors duration-(--transition-fast) hover:bg-(--hover-bg) hover:text-foreground"
              >
                <Kbd>{hint.prefix}</Kbd>
                <span>{stripPrefix(t(hint.labelKey))}</span>
              </button>
            ))}
          </div>
        ) : null}
        <ul ref={listRef} id={listboxId} role="listbox" aria-label={t("palette.title")} className="min-h-0 flex-1 overflow-auto border-t px-2 pb-2">
          {flatResults.length === 0 ? <li role="presentation" className="px-4 py-10 text-center text-sm text-muted-foreground">{t("palette.empty")}</li> : null}
          {groups.map((group) => (
            <li key={group.key} role="presentation">
              <div id={`${listboxId}-group-${group.key}`} className="sticky top-0 z-10 bg-card px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{group.label}</div>
              <ul role="group" aria-labelledby={`${listboxId}-group-${group.key}`} className="space-y-px">
                {group.entries.map((entry) => {
                  globalIndex += 1;
                  const index = globalIndex;
                  const Icon = entry.icon;
                  const SecondaryIcon = entry.secondaryIcon;
                  const active = index === cursor;
                  const segments = highlightRanges(entry.title, rest, locale);
                  return (
                    <li
                      key={entry.id}
                      id={`${listboxId}-${index}`}
                      role="option"
                      aria-selected={active}
                      data-tone={entry.tone}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => runPrimary(entry)}
                      className={cn(
                        "group flex h-10 cursor-default items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-(--transition-fast)",
                        active ? "bg-(--hover-bg) text-foreground" : "text-foreground/90",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md",
                          entry.tone ? "tone-tile" : active ? "bg-primary/10 text-primary" : "bg-(--hover-bg) text-muted-foreground",
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span title={entry.title} className="min-w-0 flex-1 truncate">
                        {segments.map((segment, segmentIndex) =>
                          segment.matched ? (
                            <mark key={segmentIndex} className="rounded-sm bg-transparent font-semibold text-primary">
                              {segment.text}
                            </mark>
                          ) : (
                            <span key={segmentIndex}>{segment.text}</span>
                          ),
                        )}
                      </span>
                      <span title={entry.subtitle} className={cn("max-w-[35%] truncate text-xs text-muted-foreground", entry.monoSubtitle && "font-mono text-[11px]")}>
                        {entry.subtitle}
                      </span>
                      {entry.secondaryRun && SecondaryIcon ? (
                        <button
                          type="button"
                          title={entry.secondaryLabel}
                          aria-label={entry.secondaryLabel}
                          onClick={(event) => {
                            event.stopPropagation();
                            runSecondary(entry);
                          }}
                          className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover:flex"
                        >
                          <SecondaryIcon className="size-3.5" aria-hidden />
                        </button>
                      ) : null}
                      {active ? <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <div className="flex h-9 shrink-0 items-center gap-4 border-t bg-muted/40 px-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Kbd>↑↓</Kbd>
            {t("palette.navigate")}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            {t("palette.open")}
          </span>
          {activeEntry?.secondaryRun ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Kbd>Ctrl ↵</Kbd>
              <span className="truncate">{activeEntry.secondaryLabel}</span>
            </span>
          ) : null}
          <span className="flex-1" />
          <span className="font-mono">
            {flatResults.length} / {MAX_RESULTS}
          </span>
        </div>
      </div>
    </div>
  );
}

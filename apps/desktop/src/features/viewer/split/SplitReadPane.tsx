import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Link2, Link2Off, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MatchFlag } from "@embedpdf/models";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useSearch } from "@embedpdf/plugin-search/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { describeError } from "@/shared/lib/errorMessage";
import type { PageColorScheme } from "@/shared/lib/pageColors";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { fileNameOf } from "@/shared/rpc/files";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { useSplitViewStore } from "@/shared/store/splitViewStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { copySelection } from "../copySelection";
import { PageView } from "../PageView";
import { effectiveSearchQuery } from "../search/searchQuery";
import { useSearchBarState } from "../search/useSearchBarState";
import { useUnsavedMarks } from "../useUnsavedMarks";
import { SplitDocumentPicker } from "./SplitDocumentPicker";
import { SplitPasswordForm } from "./SplitPasswordForm";
import { useRestoredSplitPage } from "./useRestoredSplitPage";
import { useSplitDocument } from "./useSplitDocument";
import { useSyncedScroll } from "./useSyncedScroll";

const SEARCH_DEBOUNCE_MS = 250;

type SplitReadPaneProps = {
  primaryId: string;
  primaryPath: string;
  path: string;
  password: string | null;
  separate: boolean;
  syncScroll: boolean;
  pageColors: PageColorScheme;
};

export function SplitReadPane({ primaryId, primaryPath, path, password, separate, syncScroll, pageColors }: SplitReadPaneProps) {
  const { t } = useTranslation();
  const revision = useSplitViewStore((state) => state.revisions[path] ?? 0);
  const [attempt, setAttempt] = useState(0);
  const { documentId, status, error } = useSplitDocument(path, password, revision, attempt);
  const unsavedMarks = useUnsavedMarks(primaryId);
  const queued = usePendingChangesStore((state) => pendingChangesFor(state.changes, primaryId).length);
  const unsaved = !separate && (unsavedMarks || queued > 0);
  const locked = separate && status === "error" && error?.code === "NEEDS_PASSWORD";
  const name = fileNameOf(path);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label={t("viewer.split.pane", { name })} data-split-pane="" data-split-document={documentId ?? undefined}>
      <div className="glass-flat flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <Eye className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <SplitDocumentPicker primaryId={primaryId} primaryPath={primaryPath} path={path} name={name} separate={separate} />
        <span className="glass-chip shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground">{t("viewer.split.readOnly")}</span>
        {unsaved ? <span className="min-w-0 flex-1 truncate text-muted-foreground" role="status">{t("viewer.split.unsaved")}</span> : <span className="flex-1" />}
        {documentId ? <PaneCounter documentId={documentId} /> : null}
        <IconButton
          icon={syncScroll ? Link2 : Link2Off}
          label={t("viewer.split.syncScroll")}
          active={syncScroll}
          aria-pressed={syncScroll}
          onClick={() => useSplitViewStore.getState().toggleSync(primaryPath)}
        />
        <IconButton icon={X} label={t("viewer.split.close")} onClick={() => useSplitViewStore.getState().close(primaryPath)} />
      </div>
      <div className="relative min-h-0 flex-1">
        {status === "success" && documentId ? (
          <ReadPaneDocument key={documentId} documentId={documentId} primaryId={primaryId} syncScroll={syncScroll} path={path} password={password} pageColors={pageColors} />
        ) : locked ? (
          <SplitPasswordForm key={`${path}:${password ?? ""}`} name={name} wrong={password !== null} onSubmit={(value) => useSplitViewStore.getState().setSecondary(primaryPath, { path, password: value })} />
        ) : status === "error" ? (
          <ErrorState title={t("viewer.split.openFailed")} message={error ? describeError(t, error) : t("errors.INTERNAL")} onRetry={() => setAttempt((value) => value + 1)} />
        ) : (
          <div className="p-6" aria-busy="true">
            <SkeletonCard lines={8} />
          </div>
        )}
      </div>
    </section>
  );
}

function PaneCounter({ documentId }: { documentId: string }) {
  const { state } = useScroll(documentId);
  if (state.totalPages === 0) return null;
  return (
    <span className="shrink-0 font-mono tabular-nums text-muted-foreground" data-split-page={state.currentPage}>
      {state.currentPage} / {state.totalPages}
    </span>
  );
}

type ReadPaneDocumentProps = { documentId: string; primaryId: string; syncScroll: boolean; path: string; password: string | null; pageColors: PageColorScheme };

function ReadPaneDocument({ documentId, primaryId, syncScroll, path, password, pageColors }: ReadPaneDocumentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { provides: search } = useSearch(documentId);
  const { provides: selection } = useSelectionCapability();
  const searchOpen = useViewerPanelsStore((state) => state.panels.search);
  const query = useSearchBarState((state) => state.query);
  const caseSensitive = useSearchBarState((state) => state.caseSensitive);
  const wholeWord = useSearchBarState((state) => state.wholeWord);
  const source = useMemo(() => ({ path, password }), [path, password]);
  useRestoredSplitPage(documentId, path);
  useSyncedScroll(syncScroll, primaryId, documentId);

  useEffect(() => {
    if (!search || !searchOpen) return;
    search.startSearch();
    return () => search.stopSearch();
  }, [search, searchOpen]);

  useEffect(() => {
    if (!search || !searchOpen) return;
    const flags: MatchFlag[] = [];
    if (caseSensitive) flags.push(MatchFlag.MatchCase);
    if (wholeWord) flags.push(MatchFlag.MatchWholeWord);
    search.setFlags(flags);
    const timer = window.setTimeout(() => search.searchAllPages(effectiveSearchQuery(query)), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, searchOpen, query, caseSensitive, wholeWord]);

  useEffect(() => {
    if (!selection) return;
    let inPane = false;
    const onPointerDown = (event: PointerEvent) => {
      inPane = event.target instanceof Node && (hostRef.current?.contains(event.target) ?? false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!inPane || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c" || isTypingTarget(event.target)) return;
      const scope = selection.forDocument(documentId);
      if (!scope.getState().selection) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void copySelection(scope);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [selection, documentId]);

  return (
    <div ref={hostRef} className="h-full">
      <PageView documentId={documentId} pageColors={pageColors} readOnly readOnlySource={source} />
    </div>
  );
}

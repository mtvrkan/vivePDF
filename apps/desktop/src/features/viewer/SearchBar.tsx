import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, ListFilter, WholeWord, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MatchFlag } from "@embedpdf/models";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useSearch } from "@embedpdf/plugin-search/react";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { useSearchRequestStore } from "@/shared/store/searchRequestStore";
import { effectiveSearchQuery } from "./search/searchQuery";
import { useSearchBarState } from "./search/useSearchBarState";

const DEBOUNCE_MS = 250;

type SearchBarProps = {
  documentId: string;
  onClose: () => void;
};

export function SearchBar({ documentId, onClose }: SearchBarProps) {
  const { t } = useTranslation();
  const { state, provides: search } = useSearch(documentId);
  const { provides: scroll } = useScroll(documentId);
  const query = useSearchBarState((store) => store.query);
  const setQuery = useSearchBarState((store) => store.setQuery);
  const caseSensitive = useSearchBarState((store) => store.caseSensitive);
  const setCaseSensitive = useSearchBarState((store) => store.setCaseSensitive);
  const wholeWord = useSearchBarState((store) => store.wholeWord);
  const setWholeWord = useSearchBarState((store) => store.setWholeWord);
  const resultsOpen = useSearchBarState((store) => store.resultsOpen);
  const setResultsOpen = useSearchBarState((store) => store.setResultsOpen);
  const focusNonce = useSearchBarState((store) => store.focusNonce);
  const requestNonce = useSearchRequestStore((store) => store.nonce);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!search || !scroll) return;
    const reveal = (index: number) => {
      const result = search.getState().results[index];
      if (!result) return;
      const rect = result.rects[0];
      scroll.scrollToPage({
        pageNumber: result.pageIndex + 1,
        pageCoordinates: rect ? { x: rect.origin.x, y: rect.origin.y } : undefined,
        behavior: "smooth",
        alignY: 0.35,
      });
    };
    const offActive = search.onActiveResultChange((index) => reveal(index));
    const offResult = search.onSearchResult(() => reveal(search.getState().activeResultIndex));
    return () => {
      offActive();
      offResult();
    };
  }, [search, scroll]);

  useEffect(() => {
    search?.startSearch();
    return () => search?.stopSearch();
  }, [search]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (focusNonce === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  useEffect(() => {
    if (!search) return;
    const flags: MatchFlag[] = [];
    if (caseSensitive) flags.push(MatchFlag.MatchCase);
    if (wholeWord) flags.push(MatchFlag.MatchWholeWord);
    search.setFlags(flags);
  }, [search, caseSensitive, wholeWord]);

  const runSearch = useCallback(
    (value: string) => {
      if (!search) return;
      search.searchAllPages(effectiveSearchQuery(value));
    },
    [search],
  );

  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [query, caseSensitive, wholeWord, runSearch]);

  useEffect(() => {
    const requested = useSearchRequestStore.getState().take("viewer");
    if (requested === null) return;
    setQuery(requested);
    runSearch(requested);
    inputRef.current?.focus();
    inputRef.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestNonce]);

  const goNext = useCallback(() => search?.nextResult(), [search]);
  const goPrevious = useCallback(() => search?.previousResult(), [search]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F3") return;
      if (event.target === inputRef.current) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) goPrevious();
      else goNext();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [goNext, goPrevious]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter" || event.key === "F3") {
      event.preventDefault();
      if (event.shiftKey) goPrevious();
      else goNext();
    }
  };

  const grouped = useMemo(() => {
    const buckets = new Map<number, number[]>();
    state.results.forEach((result, index) => {
      const bucket = buckets.get(result.pageIndex);
      if (bucket) bucket.push(index);
      else buckets.set(result.pageIndex, [index]);
    });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([pageIndex, indices]) => ({ pageIndex, indices }));
  }, [state.results]);

  const position = state.total > 0 ? `${state.activeResultIndex + 1} / ${state.total}` : `0 / 0`;

  return (
    <div className="relative z-40 border-b">
      <div className="flex h-row items-center gap-1 glass-flat px-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("viewer.searchPlaceholder")}
          aria-label={t("viewer.search")}
          className="field-inline h-7 w-64 rounded-md px-2 text-sm"
        />
        <IconButton
          icon={CaseSensitive}
          label={t("viewer.searchMatchCase")}
          active={caseSensitive}
          onClick={() => setCaseSensitive(!caseSensitive)}
        />
        <IconButton
          icon={WholeWord}
          label={t("viewer.searchWholeWord")}
          active={wholeWord}
          onClick={() => setWholeWord(!wholeWord)}
        />
        <span className="w-20 font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {state.loading ? t("common.loading") : position}
        </span>
        <IconButton icon={ChevronUp} label={t("viewer.previousResult")} disabled={state.total === 0} onClick={goPrevious} />
        <IconButton icon={ChevronDown} label={t("viewer.nextResult")} disabled={state.total === 0} onClick={goNext} />
        <IconButton
          icon={ListFilter}
          label={t("viewer.searchToggleResults")}
          active={resultsOpen}
          disabled={state.total === 0}
          onClick={() => setResultsOpen(!resultsOpen)}
        />
        <IconButton icon={X} label={t("common.close")} onClick={onClose} />
      </div>
      {resultsOpen && state.total > 0 ? (
        <div className="glass-flat absolute inset-x-0 top-full max-h-72 overflow-auto border-b p-2 shadow-(--shadow-float)">
          {grouped.map((group) => (
            <div key={group.pageIndex} className="mb-2 last:mb-0">
              <p className="px-1 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("viewer.searchPageGroup", { page: group.pageIndex + 1, count: group.indices.length })}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.indices.map((index) => {
                  const result = state.results[index];
                  const active = index === state.activeResultIndex;
                  return (
                    <li key={index}>
                      <button
                        type="button"
                        onClick={() => search?.goToResult(index)}
                        className={cn(
                          "nav-glass flex w-full items-start rounded-lg px-2.5 py-1.5 text-start text-sm leading-snug",
                          active && "glass-chip text-foreground",
                        )}
                      >
                        <span className="min-w-0 flex-1 text-foreground/85">
                          {result.context.truncatedLeft ? "…" : ""}
                          {result.context.before}
                          <mark className="rounded-sm bg-primary/25 px-0.5 text-foreground">{result.context.match}</mark>
                          {result.context.after}
                          {result.context.truncatedRight ? "…" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

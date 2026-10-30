import { useEffect, useRef, useState } from "preact/hooks";
import { useScroll } from "@embedpdf/plugin-scroll/preact";
import { useSearch } from "@embedpdf/plugin-search/preact";
import { Icon } from "./Icon";
import { useT } from "./i18nContext";

const DEBOUNCE_MS = 250;

type SearchBoxProps = { documentId: string; open: boolean; onOpenChange: (open: boolean) => void };

export function SearchBox({ documentId, open, onOpenChange }: SearchBoxProps) {
  const t = useT();
  const { state, provides: search } = useSearch(documentId);
  const { provides: scroll } = useScroll(documentId);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (!search || !scroll) return;
    const reveal = (index: number) => {
      const result = search.getState().results[index];
      if (!result) return;
      const rect = result.rects[0];
      scroll.scrollToPage({
        pageNumber: result.pageIndex + 1,
        pageCoordinates: rect ? { x: rect.origin.x, y: rect.origin.y } : undefined,
        behavior: "instant",
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
    if (!search) return;
    if (!open) {
      search.stopSearch();
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false;
        buttonRef.current?.focus();
      }
      return;
    }
    search.startSearch();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [search, open]);

  useEffect(() => {
    if (!search || !open) return;
    const timer = window.setTimeout(() => {
      const trimmed = query.trim();
      if (trimmed) search.searchAllPages(trimmed);
      else search.stopSearch();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, open, query]);

  const close = () => {
    restoreFocusRef.current = true;
    onOpenChange(false);
  };

  if (!open)
    return (
      <div class="vp-search vp-glass">
        <button ref={buttonRef} class="vp-btn" type="button" aria-label={t("search")} title={t("search")} onClick={() => onOpenChange(true)}>
          <Icon name="search" />
        </button>
      </div>
    );

  const hasQuery = query.trim().length > 0;
  const status = !hasQuery ? "" : state.loading ? t("searching") : state.total > 0 ? t("searchCount", { current: state.activeResultIndex + 1, total: state.total }) : t("searchNone");

  return (
    <div class="vp-search vp-glass" data-open="true" role="search">
      <label class="vp-search-field">
        <Icon name="search" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          enterKeyHint="search"
          autoComplete="off"
          spellcheck={false}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (state.total > 0) {
                if (event.shiftKey) search?.previousResult();
                else search?.nextResult();
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        />
      </label>
      <span class="vp-search-count" role="status" aria-live="polite">
        {status}
      </span>
      <button class="vp-btn" type="button" aria-label={t("previousResult")} disabled={state.total === 0} onClick={() => search?.previousResult()}>
        <Icon name="up" />
      </button>
      <button class="vp-btn" type="button" aria-label={t("nextResult")} disabled={state.total === 0} onClick={() => search?.nextResult()}>
        <Icon name="down" />
      </button>
      <button class="vp-btn" type="button" aria-label={t("closeSearch")} onClick={close}>
        <Icon name="close" />
      </button>
    </div>
  );
}

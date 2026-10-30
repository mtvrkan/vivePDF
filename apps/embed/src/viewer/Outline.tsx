import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PdfBookmarkObject } from "@embedpdf/models";
import { useRegistry } from "@embedpdf/core/preact";
import { useScroll } from "@embedpdf/plugin-scroll/preact";
import { Icon } from "./Icon";
import { useT } from "./i18nContext";
import { openExternal, safeExternalUrl } from "./links";
import { activeRowId, ancestorIds, flattenOutline, treeMove, visibleRows, type OutlineRow } from "./outlineTree";

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; rows: OutlineRow[] };

export function Outline({ documentId, sourceUrl, onPick }: { documentId: string; sourceUrl: string; onPick: () => void }) {
  const t = useT();
  const { registry, documents } = useRegistry();
  const pdfDocument = documents[documentId]?.document ?? null;
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!registry || !pdfDocument) return;
    let cancelled = false;
    setLoad({ status: "loading" });
    registry
      .getEngine()
      .getBookmarks(pdfDocument)
      .wait(
        (result: { bookmarks: PdfBookmarkObject[] }) => {
          if (!cancelled) setLoad({ status: "ready", rows: flattenOutline(result.bookmarks) });
        },
        () => {
          if (!cancelled) setLoad({ status: "error" });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [registry, pdfDocument, attempt]);

  const rows = load.status === "ready" ? load.rows : [];
  const activeId = useMemo(() => activeRowId(rows, scrollState.currentPage - 1), [rows, scrollState.currentPage]);

  useEffect(() => {
    if (!activeId) return;
    setExpanded((previous) => {
      const missing = ancestorIds(activeId).filter((id) => !previous.has(id));
      return missing.length === 0 ? previous : new Set([...previous, ...missing]);
    });
  }, [activeId]);

  const visible = useMemo(() => visibleRows(rows, expanded), [rows, expanded]);
  const tabStop = visible.some((row) => row.id === focusedId) ? focusedId : (visible.find((row) => row.id === activeId)?.id ?? visible[0]?.id ?? null);

  useEffect(() => {
    if (!activeId) return;
    treeRef.current?.querySelector(`[data-row="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, load.status]);

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const activate = (row: OutlineRow) => {
    if (row.pageIndex !== null) {
      scroll?.scrollToPage({ pageNumber: row.pageIndex + 1, behavior: "instant" });
      onPick();
      return;
    }
    const url = row.uri ? safeExternalUrl(row.uri, sourceUrl) : null;
    if (url) openExternal(url);
  };

  if (load.status === "loading") return <p class="vp-panel-note" role="status">{t("outlineLoading")}</p>;
  if (load.status === "error")
    return (
      <div class="vp-panel-note" role="alert">
        <p>{t("outlineError")}</p>
        <button type="button" class="vp-text-btn" onClick={() => setAttempt((value) => value + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  if (rows.length === 0)
    return (
      <div class="vp-panel-note">
        <Icon name="list" />
        <p class="vp-note-title">{t("outlineEmptyTitle")}</p>
        <p>{t("outlineEmpty")}</p>
      </div>
    );

  return (
    <ul ref={treeRef} class="vp-tree" role="tree" aria-label={t("outlineTab")}>
      {visible.map((row) => {
        const open = expanded.has(row.id);
        const linkable = row.pageIndex !== null || (row.uri !== null && safeExternalUrl(row.uri, sourceUrl) !== null);
        return (
          <li
            key={row.id}
            data-row={row.id}
            role="treeitem"
            class="vp-tree-row"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? open : undefined}
            aria-current={row.id === activeId ? "location" : undefined}
            aria-disabled={linkable ? undefined : true}
            tabIndex={row.id === tabStop ? 0 : -1}
            style={{ paddingInlineStart: `${4 + row.depth * 14}px` }}
            onFocus={() => setFocusedId(row.id)}
            onClick={() => activate(row)}
            onKeyDown={(event) => {
              const move = treeMove(visible, row.id, event.key, expanded);
              if (!move) return;
              event.preventDefault();
              if (move.focus) treeRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(move.focus)}"]`)?.focus();
              if (move.toggle) toggle(move.toggle);
              if (move.activate) activate(row);
            }}
          >
            <span
              class="vp-tree-twisty"
              data-open={open ? "true" : "false"}
              aria-hidden="true"
              onClick={(event) => {
                if (!row.hasChildren) return;
                event.stopPropagation();
                toggle(row.id);
              }}
            >
              {row.hasChildren ? <Icon name="chevron" /> : null}
            </span>
            <span class="vp-tree-title">{row.title}</span>
            {row.pageIndex !== null ? <span class="vp-tree-page">{row.pageIndex + 1}</span> : row.uri ? <Icon name="external" /> : null}
          </li>
        );
      })}
    </ul>
  );
}

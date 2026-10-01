import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Bookmark, ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink, ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useRegistry } from "@embedpdf/core/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { openExternal } from "@/shared/lib/openExternal";
import { pageLabelOf } from "@/shared/lib/pageLabels";
import { usePageLabels } from "@/shared/store/pageLabelsStore";
import { useToastStore } from "@/shared/store/toastStore";
import { isOpenableUri } from "./linkUri";
import { activeOutlineId, ancestorIds, flattenOutline, shownActiveId, visibleOutline, type OutlineRow } from "./outlineTree";
import { usePageNavigation } from "./usePageNavigation";

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; rows: OutlineRow[] };

export function OutlinePanel({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const navigate = useNavigate();
  const { registry, documents } = useRegistry();
  const pdfDocument = documents[documentId]?.document ?? null;
  const { state: scrollState } = useScroll(documentId);
  const { followLink } = usePageNavigation(documentId);
  const labels = usePageLabels(documentId);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState("");
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
        (result) => {
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

  const rows = useMemo(() => (load.status === "ready" ? load.rows : []), [load]);
  const activeId = useMemo(() => activeOutlineId(rows, scrollState.currentPage - 1), [rows, scrollState.currentPage]);

  useEffect(() => {
    if (activeId === null) return;
    const needed = ancestorIds(activeId);
    setExpanded((current) => (needed.every((id) => current.has(id)) ? current : new Set([...current, ...needed])));
  }, [activeId]);

  const visible = useMemo(() => visibleOutline(rows, expanded, filter), [rows, expanded, filter]);
  const markedId = shownActiveId(visible, activeId);
  const tabStopId = visible.some((row) => row.id === focusedId) ? focusedId : (markedId ?? visible[0]?.id ?? null);
  const filtering = filter.trim().length > 0;

  useEffect(() => {
    if (!markedId || filtering) return;
    treeRef.current?.querySelector<HTMLElement>(`[data-outline-id="${markedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [markedId, filtering]);

  const setBranch = (id: string, open: boolean) =>
    setExpanded((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const activate = (row: OutlineRow) => {
    if (row.target && row.pageIndex !== null) {
      followLink(row.target, row.pageIndex);
      return;
    }
    if (row.uri && isOpenableUri(row.uri)) void openExternal(row.uri).catch(() => toast("error", t("viewer.link.openFailed")));
  };

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    treeRef.current?.querySelector<HTMLElement>(`[data-outline-id="${id}"]`)?.focus();
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = visible.findIndex((row) => row.id === tabStopId);
    const row = visible[index];
    if (!row) return;
    const open = filtering || expanded.has(row.id);
    const handled = (() => {
      switch (event.key) {
        case "ArrowDown":
          focusRow(visible[index + 1]?.id);
          return true;
        case "ArrowUp":
          focusRow(visible[index - 1]?.id);
          return true;
        case "Home":
          focusRow(visible[0]?.id);
          return true;
        case "End":
          focusRow(visible[visible.length - 1]?.id);
          return true;
        case "ArrowRight":
          if (row.hasChildren && !open) setBranch(row.id, true);
          else if (row.hasChildren) focusRow(visible[index + 1]?.id);
          return true;
        case "ArrowLeft":
          if (row.hasChildren && open && !filtering) setBranch(row.id, false);
          else if (row.parentId !== null) focusRow(row.parentId);
          return true;
        case "Enter":
        case " ":
          activate(row);
          return true;
        default:
          return false;
      }
    })();
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const branchIds = rows.filter((row) => row.hasChildren).map((row) => row.id);

  return (
    <aside aria-label={t("viewer.outline.title")} className="glass-flat flex h-full w-64 flex-col border-e">
      <div className="flex h-row items-center gap-2 border-b px-3">
        <ListTree className="size-4 text-primary" aria-hidden />
        <span className="flex-1 truncate text-sm font-semibold">{t("viewer.outline.title")}</span>
        <IconButton icon={ChevronsUpDown} label={t("viewer.outline.expandAll")} disabled={branchIds.length === 0 || filtering} onClick={() => setExpanded(new Set(branchIds))} />
        <IconButton icon={ChevronsDownUp} label={t("viewer.outline.collapseAll")} disabled={branchIds.length === 0 || filtering} onClick={() => setExpanded(new Set())} />
      </div>
      {load.status === "loading" ? (
        <div className="p-2">
          <SkeletonCard lines={6} />
        </div>
      ) : null}
      {load.status === "error" ? <ErrorState title={t("viewer.outline.loadFailed")} message={t("viewer.outline.loadFailedHint")} onRetry={() => setAttempt((value) => value + 1)} /> : null}
      {load.status === "ready" && rows.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title={t("viewer.outline.empty")}
          description={t("viewer.outline.emptyHint")}
          action={
            <Button size="sm" icon={<Bookmark className="size-4" aria-hidden />} onClick={() => void navigate("/tools/edit?tab=bookmarks")}>
              {t("viewer.outline.create")}
            </Button>
          }
        />
      ) : null}
      {load.status === "ready" && rows.length > 0 ? (
        <>
          <div className="border-b p-2">
            <TextInput
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && visible.length > 0) {
                  event.preventDefault();
                  focusRow(visible[0].id);
                }
              }}
              placeholder={t("viewer.outline.filter")}
              aria-label={t("viewer.outline.filter")}
              className="h-8 w-full text-sm"
            />
          </div>
          {visible.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{t("viewer.outline.noMatches")}</p> : null}
          <ul ref={treeRef} role="tree" aria-label={t("viewer.outline.title")} onKeyDown={onTreeKeyDown} className="min-h-0 flex-1 overflow-auto py-1">
            {visible.map((row) => {
              const open = filtering || expanded.has(row.id);
              const marked = row.id === markedId;
              const navigable = row.pageIndex !== null || (row.uri !== null && isOpenableUri(row.uri));
              return (
                <li
                  key={row.id}
                  role="treeitem"
                  data-outline-id={row.id}
                  aria-level={row.depth + 1}
                  aria-expanded={row.hasChildren ? open : undefined}
                  aria-selected={marked}
                  aria-disabled={navigable ? undefined : true}
                  tabIndex={row.id === tabStopId ? 0 : -1}
                  title={row.title}
                  onFocus={() => setFocusedId(row.id)}
                  onClick={() => {
                    setFocusedId(row.id);
                    activate(row);
                  }}
                  style={{ paddingInlineStart: `calc(var(--spacing) * ${row.depth * 4 + 1})` }}
                  className={cn(
                    "mx-1 flex min-h-8 cursor-pointer items-center gap-1 rounded-md pe-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    marked ? "bg-primary/12 font-semibold text-foreground" : "text-foreground/90 hover:bg-muted",
                    navigable ? "" : "cursor-default text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    onClick={(event) => {
                      if (!row.hasChildren || filtering) return;
                      event.stopPropagation();
                      setBranch(row.id, !open);
                    }}
                    className={cn("flex size-5 shrink-0 items-center justify-center rounded-sm", row.hasChildren && !filtering ? "hover:bg-muted" : "")}
                  >
                    {row.hasChildren ? <ChevronRight className={cn("size-3.5 transition-transform duration-(--transition-fast)", open ? "rotate-90" : "")} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate py-1">{row.title || t("viewer.outline.untitled")}</span>
                  {row.pageIndex !== null ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{pageLabelOf(labels, row.pageIndex + 1)}</span> : null}
                  {row.pageIndex === null && row.uri !== null ? <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </aside>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, CornerDownRight, IndentDecrease, IndentIncrease, Link2, ListTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { TextInput } from "@/components/tool/form";
import { type BookmarkIssue, bookmarkIssue, moveBookmarkBranch } from "@/shared/lib/bookmarkTree";
import { cn } from "@/shared/lib/cn";
import { pageLabelOf } from "@/shared/lib/pageLabels";
import { getBookmarks } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePageLabels } from "@/shared/store/pageLabelsStore";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import type { BookmarkItem } from "@/types";
import type { OutlineRow } from "../outlineTree";
import {
  canIndent,
  canOutdent,
  deleteBookmarkBranch,
  indentBookmark,
  insertChild,
  insertSibling,
  linkBookmarkToPage,
  mergeAddedBookmarks,
  outdentBookmark,
  pendingAdditions,
  pendingOutline,
  renameBookmark,
  rowsFromItems,
} from "./outlineEdit";

const ISSUE_MESSAGES: Record<BookmarkIssue, string> = {
  levels: "tools.edit.bookmarks.invalidLevels",
  title: "tools.edit.bookmarks.invalidTitle",
  page: "tools.edit.bookmarks.invalidPage",
};

type EditorLoad = { status: "loading" } | { status: "error" } | { status: "ready"; items: BookmarkItem[] };
type Rename = { index: number; draft: string };

type OutlineEditorProps = {
  documentId: string;
  pageCount: number;
  currentPage: number;
  reloadKey: unknown;
  onOpen: (row: OutlineRow) => void;
};

export function OutlineEditor({ documentId, pageCount, currentPage, reloadKey, onOpen }: OutlineEditorProps) {
  const { t } = useTranslation();
  const labels = usePageLabels(documentId);
  const path = useDocumentStore((state) => state.documents[documentId]?.path);
  const password = useDocumentStore((state) => state.documents[documentId]?.password);
  const pendingItems = usePendingChangesStore((state) => pendingOutline(pendingChangesFor(state.changes, documentId))?.items ?? null);
  const additionCount = usePendingChangesStore((state) => pendingAdditions(pendingChangesFor(state.changes, documentId)).length);
  const [load, setLoad] = useState<EditorLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [rename, setRename] = useState<Rename | null>(null);
  const [issue, setIssue] = useState<BookmarkIssue | null>(null);
  const renameRef = useRef<Rename | null>(null);
  const focusPendingRef = useRef(false);
  const treeRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoad({ status: "loading" });
    getBookmarks({ path, password: password ?? undefined }).then(
      (result) => {
        if (!cancelled) setLoad({ status: "ready", items: result.items });
      },
      () => {
        if (!cancelled) setLoad({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, password, reloadKey, attempt]);

  useEffect(() => {
    if (load.status !== "ready" || additionCount === 0) return;
    const store = usePendingChangesStore.getState();
    const changes = pendingChangesFor(store.changes, documentId);
    const additions = pendingAdditions(changes);
    const base = pendingOutline(changes)?.items ?? load.items;
    store.replace(documentId, { kind: "outlineReplaced", items: mergeAddedBookmarks(base, additions), label: t("viewer.outline.pendingLabel") });
    additions.forEach((addition) => store.drop(documentId, addition.id));
  }, [load, additionCount, documentId, t]);

  const items = pendingItems ?? (load.status === "ready" ? load.items : null);
  const rows = items ? rowsFromItems(items) : [];
  const current = selected !== null && items && selected < items.length ? selected : null;

  useEffect(() => {
    if (!focusPendingRef.current || current === null || renameRef.current) return;
    focusPendingRef.current = false;
    treeRef.current?.querySelector<HTMLElement>(`[data-outline-index="${current}"]`)?.focus();
  });

  const setRenameState = (next: Rename | null) => {
    renameRef.current = next;
    setRename(next);
  };

  const commit = (next: BookmarkItem[], nextSelected: number | null) => {
    const found = bookmarkIssue(next, pageCount);
    if (found) {
      setIssue(found);
      return false;
    }
    setIssue(null);
    usePendingChangesStore.getState().replace(documentId, { kind: "outlineReplaced", items: next, label: t("viewer.outline.pendingLabel") });
    focusPendingRef.current = true;
    setSelected(nextSelected);
    return true;
  };

  const select = (index: number | undefined) => {
    if (index === undefined || !items || index < 0 || index >= items.length) return;
    focusPendingRef.current = true;
    setSelected(index);
  };

  const startRename = (index: number) => {
    if (!items?.[index]) return;
    setSelected(index);
    setRenameState({ index, draft: items[index].title });
  };

  const cancelRename = () => {
    setRenameState(null);
    setIssue(null);
    focusPendingRef.current = true;
  };

  const finishRename = () => {
    const active = renameRef.current;
    if (!active || !items) return;
    const title = active.draft.trim();
    if (!title) {
      setIssue("title");
      return;
    }
    if (commit(renameBookmark(items, active.index, title), active.index)) setRenameState(null);
  };

  const newEntry = (): Omit<BookmarkItem, "level"> => ({ title: t("viewer.outline.newBookmark"), page: currentPage, top: null });

  const addSibling = () => {
    const inserted = insertSibling(items ?? [], current, newEntry());
    if (commit(inserted.items, inserted.index)) setRenameState({ index: inserted.index, draft: inserted.items[inserted.index].title });
  };

  const addChild = () => {
    if (!items || current === null) return;
    const inserted = insertChild(items, current, newEntry());
    if (commit(inserted.items, inserted.index)) setRenameState({ index: inserted.index, draft: inserted.items[inserted.index].title });
  };

  const remove = (index: number) => {
    if (!items) return;
    const next = deleteBookmarkBranch(items, index);
    commit(next, next.length === 0 ? null : Math.min(index, next.length - 1));
  };

  const move = (index: number, delta: number) => {
    if (!items) return;
    const next = moveBookmarkBranch(items, index, delta);
    if (next !== items) commit(next, next.indexOf(items[index]));
  };

  const open = (index: number) => {
    const row = rows[index];
    if (row) onOpen(row);
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!items || current === null || event.ctrlKey || event.metaKey) return;
    const handled = (() => {
      if (event.altKey) {
        if (event.key === "ArrowUp") move(current, -1);
        else if (event.key === "ArrowDown") move(current, 1);
        else return false;
        return true;
      }
      switch (event.key) {
        case "ArrowDown":
          select(current + 1);
          return true;
        case "ArrowUp":
          select(current - 1);
          return true;
        case "Home":
          select(0);
          return true;
        case "End":
          select(items.length - 1);
          return true;
        case "F2":
          startRename(current);
          return true;
        case "Delete":
          remove(current);
          return true;
        case "Tab":
          if (event.shiftKey ? !canOutdent(items, current) : !canIndent(items, current)) return false;
          commit(event.shiftKey ? outdentBookmark(items, current) : indentBookmark(items, current), current);
          return true;
        case "Enter":
        case " ":
          open(current);
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

  if (!items) {
    if (load.status === "error") return <ErrorState title={t("viewer.outline.loadFailed")} message={t("viewer.outline.loadFailedHint")} onRetry={() => setAttempt((value) => value + 1)} />;
    return (
      <div className="p-2" aria-busy>
        <SkeletonCard lines={6} />
      </div>
    );
  }

  const none = current === null;
  const issueText = issue ? <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">{t(ISSUE_MESSAGES[issue], { count: pageCount })}</p> : null;

  return (
    <>
      <div role="toolbar" aria-label={t("viewer.outline.editTools")} className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1">
        <IconButton icon={Plus} label={t("viewer.outline.addAtPage", { page: pageLabelOf(labels, currentPage) })} onClick={addSibling} />
        <IconButton icon={CornerDownRight} label={t("viewer.outline.addChild")} disabled={none} onClick={addChild} />
        <IconButton icon={Pencil} label={t("viewer.outline.rename")} shortcut="F2" disabled={none} onClick={() => current !== null && startRename(current)} />
        <IconButton icon={IndentDecrease} label={t("tools.edit.bookmarks.outdent")} shortcut="Shift+Tab" disabled={none || !canOutdent(items, current)} onClick={() => current !== null && commit(outdentBookmark(items, current), current)} />
        <IconButton icon={IndentIncrease} label={t("tools.edit.bookmarks.indent")} shortcut="Tab" disabled={none || !canIndent(items, current)} onClick={() => current !== null && commit(indentBookmark(items, current), current)} />
        <IconButton icon={ArrowUp} label={t("tools.edit.bookmarks.moveUp")} shortcut="Alt+ArrowUp" disabled={none} onClick={() => current !== null && move(current, -1)} />
        <IconButton icon={ArrowDown} label={t("tools.edit.bookmarks.moveDown")} shortcut="Alt+ArrowDown" disabled={none} onClick={() => current !== null && move(current, 1)} />
        <IconButton icon={Link2} label={t("viewer.outline.linkToPage", { page: pageLabelOf(labels, currentPage) })} disabled={none} onClick={() => current !== null && commit(linkBookmarkToPage(items, current, currentPage), current)} />
        <IconButton icon={Trash2} label={t("common.delete")} shortcut="Del" disabled={none} onClick={() => current !== null && remove(current)} />
      </div>
      {issueText}
      {items.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title={t("tools.edit.bookmarks.empty")}
          description={t("viewer.outline.editEmptyHint")}
          action={
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={addSibling}>
              {t("tools.edit.bookmarks.add")}
            </Button>
          }
        />
      ) : (
        <ul ref={treeRef} role="tree" aria-label={t("viewer.outline.title")} onKeyDown={onTreeKeyDown} className="min-h-0 flex-1 overflow-auto py-1">
          {items.map((item, index) => {
            const row = rows[index];
            const isSelected = index === current;
            const renaming = rename?.index === index;
            return (
              <li
                key={`${row.id}-${index}`}
                role="treeitem"
                data-outline-index={index}
                aria-level={item.level}
                aria-selected={isSelected}
                tabIndex={index === (current ?? 0) ? 0 : -1}
                title={item.title}
                onFocus={() => setSelected(index)}
                onClick={() => {
                  setSelected(index);
                  open(index);
                }}
                onDoubleClick={() => startRename(index)}
                style={{ paddingInlineStart: `calc(var(--spacing) * ${row.depth * 4 + 2})` }}
                className={cn(
                  "mx-1 flex min-h-8 cursor-pointer items-center gap-1 rounded-md pe-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected ? "bg-primary/12 font-semibold text-foreground" : "text-foreground/90 hover:bg-muted",
                )}
              >
                {renaming ? (
                  <TextInput
                    autoFocus
                    value={rename.draft}
                    maxLength={500}
                    aria-label={t("tools.edit.bookmarks.titlePlaceholder")}
                    aria-invalid={issue === "title" ? true : undefined}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameState({ index, draft: event.target.value })}
                    onBlur={() => {
                      const active = renameRef.current;
                      if (!active) return;
                      if (active.draft.trim()) finishRename();
                      else cancelRename();
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        finishRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    className="h-7 min-w-0 flex-1 text-sm"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate py-1">{row.title || t("viewer.outline.untitled")}</span>
                )}
                {row.pageIndex !== null ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{pageLabelOf(labels, row.pageIndex + 1)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

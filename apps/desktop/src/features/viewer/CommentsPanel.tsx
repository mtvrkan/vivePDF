import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, ListChecks, MessageSquareText, RefreshCw, Reply, RotateCcw, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { ContextMenu, MENU_LAYER, type ContextMenuAnchor, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Checkbox, TextArea, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import { suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { exportComments, importComments, listComments } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { isCommentDeleted, pendingChangesFor, pendingReplies, reviewStateOverride, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { CommentItem, CommentsExportParams, CommentsListResult, ReviewState } from "@/types";
import { annotationAuthorName } from "./annotationAuthor";
import { commentThreads } from "./commentThreads";
import { useDocumentSave } from "./useDocumentSave";
import { useOpenPdf } from "./useOpenPdf";
import { useUnsavedMarks } from "./useUnsavedMarks";

const ALL = "__all";
const NO_STATUS = "__none";
const WITH_REPLIES = "with";
const WITHOUT_REPLIES = "without";
const REVIEW_STATES: ReviewState[] = ["Accepted", "Rejected", "Cancelled", "Completed"];
const REPLY_LIMIT = 5000;
const INDENTS = ["", "ms-4", "ms-8", "ms-12"];

function ReplyBox({ label, onSubmit, onCancel }: { label: string; onSubmit: (content: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const content = text.trim();
  const submit = () => {
    if (content) onSubmit(content);
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      <TextArea
        autoFocus
        rows={3}
        value={text}
        maxLength={REPLY_LIMIT}
        aria-label={label}
        placeholder={t("viewer.comments.replyPlaceholder")}
        className="text-sm"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" variant="primary" disabled={!content} onClick={submit}>
          {t("viewer.comments.reply")}
        </Button>
      </div>
    </div>
  );
}

export function CommentsPanel({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const { provides: scroll } = useScroll(documentId);
  const queue = usePendingChangesStore((state) => state.queue);
  const allChanges = usePendingChangesStore((state) => state.changes);
  const changes = useMemo(() => pendingChangesFor(allChanges, documentId), [allChanges, documentId]);
  const [data, setData] = useState<CommentsListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [author, setAuthor] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [page, setPage] = useState("");
  const [showResolved, setShowResolved] = useState(true);
  const [status, setStatus] = useState(ALL);
  const [replies, setReplies] = useState(ALL);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [statusMenu, setStatusMenu] = useState<{ anchor: ContextMenuAnchor; item: CommentItem } | null>(null);
  const drop = usePendingChangesStore((state) => state.drop);
  const authorPreference = usePreferencesStore((state) => state.annotationAuthor);
  const [exporting, setExporting] = useState(false);
  const { openPath } = useOpenPdf();
  const menu = useContextMenu();
  const [menuItem, setMenuItem] = useState<CommentItem | null>(null);
  const unsavedMarks = useUnsavedMarks(documentId);
  const { save } = useDocumentSave(documentId);
  const [saving, setSaving] = useState(false);

  const path = document?.path ?? null;
  const password = document?.password ?? undefined;
  const infoVersion = document?.info;

  const loadRequest = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listComments({ path, password });
      if (request === loadRequest.current) setData(result);
    } catch (caught) {
      if (request === loadRequest.current) setError(describeError(t, toRpcError(caught)));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [path, password, t]);

  useEffect(() => {
    void load();
  }, [load, infoVersion]);

  const typeLabel = useCallback((value: string) => t(`viewer.comments.types.${value}`, { defaultValue: value }), [t]);

  const effectiveState = useCallback(
    (item: CommentItem): ReviewState | null => {
      const override = reviewStateOverride(changes, item.xref);
      if (override !== null) return override.state;
      return item.state ?? (item.resolved ? "Completed" : null);
    },
    [changes],
  );

  const effectiveResolved = useCallback((item: CommentItem) => effectiveState(item) === "Completed", [effectiveState]);

  const queuedReplies = useMemo(() => {
    const byXref = new Map((data?.items ?? []).map((item) => [item.xref, item]));
    const replyAuthor = annotationAuthorName(authorPreference);
    return pendingReplies(changes).flatMap((change, index) => {
      const parent = byXref.get(change.parent);
      if (!parent) return [];
      const item: CommentItem = { xref: -(index + 1), page: parent.page, type: "Text", author: replyAuthor, subject: "", content: change.content, created: "", modified: "", color: null, rect: parent.rect, resolved: false, quote: "", parent: parent.xref, state: null };
      return [{ item, changeId: change.id }];
    });
  }, [data, changes, authorPreference]);

  const entries = useMemo(() => {
    if (!data) return [];
    const all = [...data.items, ...queuedReplies.map((entry) => entry.item)];
    const answered = new Set(all.flatMap((item) => (item.parent === null ? [] : [item.parent])));
    const pageNumber = Number.parseInt(page, 10);
    const keepRoot = (item: CommentItem) => {
      const state = effectiveState(item);
      return (
        (author === ALL || item.author === author) &&
        (type === ALL || item.type === type) &&
        (!Number.isFinite(pageNumber) || item.page === pageNumber) &&
        (showResolved || state !== "Completed" || isCommentDeleted(changes, item.xref)) &&
        (status === ALL || (status === NO_STATUS ? state === null : state === status)) &&
        (replies === ALL || answered.has(item.xref) === (replies === WITH_REPLIES))
      );
    };
    return commentThreads(all, keepRoot);
  }, [data, queuedReplies, author, type, page, showResolved, status, replies, effectiveState, changes]);

  const pendingReplyId = (item: CommentItem) => queuedReplies.find((entry) => entry.item.xref === item.xref)?.changeId ?? null;

  const commentLabel = (item: CommentItem) => item.author || item.content?.slice(0, 40) || typeLabel(item.type);

  const toggleResolved = (item: CommentItem) => {
    queue(documentId, { kind: "commentResolved", xrefs: [item.xref], resolved: !effectiveResolved(item), label: commentLabel(item) });
  };

  const requestDelete = (item: CommentItem) => {
    const changeId = pendingReplyId(item);
    if (changeId) drop(documentId, changeId);
    else queue(documentId, { kind: "commentDeleted", xrefs: [item.xref], label: commentLabel(item) });
  };

  const chooseState = (item: CommentItem, state: ReviewState | null) => {
    if (effectiveState(item) === state) return;
    queue(documentId, { kind: "commentState", xrefs: [item.xref], state, label: commentLabel(item) });
  };

  const sendReply = (item: CommentItem, content: string) => {
    queue(documentId, { kind: "commentReply", parent: item.xref, content, label: content.slice(0, 40) });
    setReplyingTo(null);
  };

  const canAnswer = (item: CommentItem) => item.xref > 0 && !isCommentDeleted(changes, item.xref);

  const stateLabel = (state: ReviewState | null) => (state ? t(`viewer.comments.states.${state}`) : t("viewer.comments.noStatus"));

  const statusItems = (item: CommentItem): ContextMenuItem[] => {
    const current = effectiveState(item);
    return [null, ...REVIEW_STATES].map((state) => ({
      type: "item" as const,
      id: `status-${state ?? "none"}`,
      label: stateLabel(state),
      checked: current === state,
      onSelect: () => chooseState(item, state),
    }));
  };

  const exportAs = async (format: CommentsExportParams["format"]) => {
    if (!path) return;
    const selected = await saveDialog({
      defaultPath: suggestOutputPath(path, t("viewer.comments.suffix"), format),
      filters: [{ name: format === "md" ? "Markdown" : format.toUpperCase(), extensions: [format] }],
    });
    if (!selected) return;
    setExporting(true);
    try {
      const typeLabels = Object.fromEntries((data?.types ?? []).map((value) => [value, typeLabel(value)]));
      const result = await exportComments({ path, password, output: selected, format, includeResolved: showResolved, overwrite: true, layout: "pages", pageLabel: t("viewer.comments.summaryPage"), typeLabels });
      toast("success", t("viewer.comments.exported", { count: result.count }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setExporting(false);
    }
  };

  const importFrom = async () => {
    if (!path) return;
    const source = await openDialog({ multiple: false, directory: false, filters: [{ name: "XFDF / FDF", extensions: ["xfdf", "fdf", "xml"] }] });
    if (typeof source !== "string") return;
    const output = await saveDialog({
      defaultPath: suggestOutputPath(path, t("viewer.comments.importSuffix")),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!output) return;
    setExporting(true);
    try {
      const result = await importComments({ path, password, source, output, overwrite: true });
      const duplicates = result.duplicates ? ` · ${t("viewer.comments.importedDuplicates", { count: result.duplicates })}` : "";
      toast("success", `${t("viewer.comments.imported", { count: result.imported })}${duplicates}`);
      await openPath(result.output);
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setExporting(false);
    }
  };

  const saveMarks = async () => {
    setSaving(true);
    try {
      await save();
    } finally {
      setSaving(false);
    }
  };

  const authorOptions = [{ value: ALL, label: t("viewer.comments.filterAuthor") }, ...(data?.authors ?? []).map((value) => ({ value, label: value }))];
  const typeOptions = [{ value: ALL, label: t("viewer.comments.filterType") }, ...(data?.types ?? []).map((value) => ({ value, label: typeLabel(value) }))];
  const statusOptions = [{ value: ALL, label: t("viewer.comments.filterStatus") }, { value: NO_STATUS, label: t("viewer.comments.noStatus") }, ...REVIEW_STATES.map((value) => ({ value, label: stateLabel(value) }))];
  const replyOptions = [
    { value: ALL, label: t("viewer.comments.filterReplies") },
    { value: WITH_REPLIES, label: t("viewer.comments.withReplies") },
    { value: WITHOUT_REPLIES, label: t("viewer.comments.withoutReplies") },
  ];

  return (
    <aside aria-label={t("viewer.comments.title")} className="flex h-full w-inspector flex-col border-s bg-card">
      <div className="flex h-row items-center gap-2 border-b px-3">
        <MessageSquareText className="size-4 text-primary" aria-hidden />
        <span className="flex-1 text-sm font-semibold">{t("viewer.comments.title")}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{data ? t("viewer.comments.count", { count: entries.length }) : ""}</span>
        <IconButton icon={RefreshCw} label={t("viewer.comments.refresh")} onClick={() => void load()} disabled={loading} />
      </div>
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="grid grid-cols-2 gap-2">
          <Select value={author} options={authorOptions} onChange={setAuthor} ariaLabel={t("viewer.comments.filterAuthor")} className="w-full" />
          <Select value={type} options={typeOptions} onChange={setType} ariaLabel={t("viewer.comments.filterType")} className="w-full" />
          <Select value={status} options={statusOptions} onChange={setStatus} ariaLabel={t("viewer.comments.filterStatus")} className="w-full" />
          <Select value={replies} options={replyOptions} onChange={setReplies} ariaLabel={t("viewer.comments.filterReplies")} className="w-full" />
        </div>
        <div className="flex items-center gap-3">
          <TextInput value={page} onChange={(event) => setPage(event.target.value)} placeholder={t("viewer.comments.page")} inputMode="numeric" className="w-24 font-mono" aria-label={t("viewer.comments.page")} />
          <Checkbox nowrap label={t("viewer.comments.showResolved")} checked={showResolved} onChange={setShowResolved} />
        </div>
      </div>
      {unsavedMarks ? (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground" role="status">
          <span className="min-w-0 flex-1">{t("viewer.comments.unsavedMarks")}</span>
          <Button size="sm" onClick={() => void saveMarks()} loading={saving}>
            {t("viewer.save.save")}
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading && !data ? <SkeletonCard lines={5} /> : null}
        {error ? <p className="p-2 text-sm text-destructive">{error}</p> : null}
        {data && data.items.length === 0 ? (
          <div className="flex flex-col gap-1 p-3 text-sm text-muted-foreground">
            <span>{t("viewer.comments.empty")}</span>
            <span className="text-xs">{t("viewer.comments.hint")}</span>
          </div>
        ) : null}
        <ul className="flex flex-col gap-1.5">
          {entries.map(({ item, depth }) => {
            const state = effectiveState(item);
            const resolved = state === "Completed";
            const pending = item.xref < 0;
            const deleted = isCommentDeleted(changes, item.xref);
            const unsaved = pending || deleted || reviewStateOverride(changes, item.xref) !== null;
            const meta = [item.author, item.created].filter(Boolean).join(" · ");
            const metaTitle = resolved ? `${meta} · ${t("viewer.comments.resolved")}` : meta;
            const heading = depth > 0 ? t("viewer.comments.reply") : typeLabel(item.type);
            return (
              <li
                key={item.xref}
                data-comment-depth={depth}
                className={cn("nav-glass rounded-xl px-3 py-2 text-sm", INDENTS[Math.min(depth, INDENTS.length - 1)], resolved ? "opacity-60" : "", deleted && !resolved ? "opacity-50" : "", deleted ? "line-through" : "")}
                onContextMenu={(event) => {
                  setMenuItem(item);
                  menu.open(event);
                }}
              >
                <button type="button" onClick={() => scroll?.scrollToPage({ pageNumber: item.page })} className="flex w-full items-center gap-2 text-start">
                  {depth > 0 ? <Reply className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <span className="size-2.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: item.color ?? "transparent" }} aria-hidden />}
                  <span title={heading} className="min-w-0 flex-1 truncate font-medium">{heading}</span>
                  {state ? <span className="glass-chip shrink-0 text-[10px] text-foreground" data-comment-state={state}>{stateLabel(state)}</span> : null}
                  {unsaved ? <span className="glass-chip shrink-0 text-[10px] text-muted-foreground">{t("viewer.pending.unsaved")}</span> : null}
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{t("viewer.comments.pageShort", { page: item.page })}</span>
                </button>
                {item.quote ? (
                  <blockquote className="mt-1 line-clamp-3 border-s-2 ps-2 text-xs italic text-muted-foreground" style={{ borderColor: item.color ?? undefined }}>
                    {item.quote}
                  </blockquote>
                ) : null}
                {item.content ? <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-foreground/85">{item.content}</p> : null}
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span title={metaTitle} className="min-w-0 flex-1 truncate">{metaTitle}</span>
                  <IconButton icon={Reply} label={t("viewer.comments.reply")} disabled={!canAnswer(item)} active={replyingTo === item.xref} onClick={() => setReplyingTo(replyingTo === item.xref ? null : item.xref)} />
                  <IconButton
                    icon={ListChecks}
                    label={t("viewer.comments.status")}
                    disabled={pending || deleted}
                    aria-haspopup="menu"
                    {...{ [MENU_LAYER]: "" }}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setStatusMenu({ anchor: { x: rect.left, y: rect.bottom + 4 }, item });
                    }}
                  />
                  <IconButton
                    icon={resolved ? RotateCcw : Check}
                    label={resolved ? t("viewer.comments.unresolve") : t("viewer.comments.resolve")}
                    disabled={pending || deleted}
                    onClick={() => toggleResolved(item)}
                  />
                  <IconButton icon={Trash2} label={pending ? t("viewer.comments.discardReply") : t("viewer.comments.delete")} disabled={deleted} onClick={() => requestDelete(item)} />
                </div>
                {replyingTo === item.xref && canAnswer(item) ? (
                  <ReplyBox label={t("viewer.comments.replyTo", { name: item.author || heading })} onSubmit={(content) => sendReply(item, content)} onCancel={() => setReplyingTo(null)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t p-3">
        <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => void exportAs("csv")} disabled={exporting || !data || data.items.length === 0}>
          CSV
        </Button>
        <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => void exportAs("pdf")} disabled={exporting || !data || data.items.length === 0}>
          PDF
        </Button>
        <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => void exportAs("xfdf")} disabled={exporting || !data || data.items.length === 0} title={t("viewer.comments.xfdfHint")}>
          XFDF
        </Button>
        <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => void exportAs("fdf")} disabled={exporting || !data || data.items.length === 0} title={t("viewer.comments.fdfHint")}>
          FDF
        </Button>
        <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => void exportAs("md")} disabled={exporting || !data || data.items.length === 0} title={t("viewer.comments.markdownHint")}>
          Markdown
        </Button>
        <IconButton icon={Upload} label={t("viewer.comments.import")} onClick={() => void importFrom()} disabled={exporting || !path} />
        <span className="ms-auto font-mono text-[11px] text-muted-foreground">{data ? formatNumber(data.items.length, locale) : ""}</span>
      </div>
      {menu.anchor && menuItem
        ? (() => {
            const menuResolved = effectiveResolved(menuItem);
            const menuDeleted = isCommentDeleted(changes, menuItem.xref);
            const menuPending = menuItem.xref < 0;
            const items: ContextMenuItem[] = [
              { type: "item", id: "go-to-page", label: t("viewer.context.goToPage"), onSelect: () => scroll?.scrollToPage({ pageNumber: menuItem.page }) },
              {
                type: "item",
                id: "copy-text",
                label: t("viewer.context.copyText"),
                disabled: !menuItem.content,
                onSelect: () => void navigator.clipboard.writeText(menuItem.content ?? ""),
              },
              { type: "item", id: "reply", icon: Reply, label: t("viewer.comments.reply"), disabled: !canAnswer(menuItem), onSelect: () => setReplyingTo(menuItem.xref) },
              {
                type: "item",
                id: "toggle-resolved",
                icon: menuResolved ? RotateCcw : Check,
                label: menuResolved ? t("viewer.comments.unresolve") : t("viewer.comments.resolve"),
                disabled: menuDeleted || menuPending,
                onSelect: () => toggleResolved(menuItem),
              },
              { type: "submenu", id: "status", icon: ListChecks, label: t("viewer.comments.status"), disabled: menuDeleted || menuPending, items: statusItems(menuItem) },
              { type: "separator", id: "sep-delete" },
              { type: "item", id: "delete", icon: Trash2, label: menuPending ? t("viewer.comments.discardReply") : t("viewer.comments.delete"), disabled: menuDeleted, onSelect: () => requestDelete(menuItem) },
            ];
            return <ContextMenu anchor={menu.anchor} items={items} label={t("viewer.comments.title")} onClose={menu.close} />;
          })()
        : null}
      {statusMenu ? <ContextMenu anchor={statusMenu.anchor} items={statusItems(statusMenu.item)} label={t("viewer.comments.status")} onClose={() => setStatusMenu(null)} /> : null}
    </aside>
  );
}

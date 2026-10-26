import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { useToastStore } from "@/shared/store/toastStore";
import { CommentCard, DraftCard } from "./CommentCard";
import { commentFocusKey, commentRanges, documentThreads } from "./commentMark";
import { MAX_COMMENTS, MAX_REPLIES, newCommentId, type CommentThread } from "./comments";
import { useCommentsView } from "./commentsView";
import { useCommentState } from "./useComments";

export const COMMENT_LANE_WIDTH = 288;
export const COMMENT_LANE_GAP = 16;
const CARD_GAP = 8;
const DRAFT = "draft";

type Item = { key: string; thread: CommentThread | null; from: number };
type Connector = { left: number; top: number; width: number };

function sameValues<T extends object>(left: T, right: T): boolean {
  const keys = Object.keys(left) as (keyof T)[];
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function placed(desired: number[], heights: number[], anchor: number): number[] {
  const tops = [...desired];
  const start = anchor >= 0 ? anchor : 0;
  for (let index = start + 1; index < tops.length; index += 1) tops[index] = Math.max(desired[index], tops[index - 1] + heights[index - 1] + CARD_GAP);
  for (let index = start - 1; index >= 0; index -= 1) tops[index] = Math.min(desired[index], tops[index + 1] - heights[index] - CARD_GAP);
  const lift = tops.length ? Math.min(0, tops[0]) : 0;
  return tops.map((top) => top - lift);
}

export function CommentLane({ editor, paper }: { editor: Editor; paper: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const { threads, focus } = useCommentState(editor);
  const lane = useRef<HTMLElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [tops, setTops] = useState<Record<string, number>>({});
  const [connector, setConnector] = useState<Connector | null>(null);

  const firstFrom = new Map<string, number>();
  for (const range of commentRanges(editor.state.doc)) if (!firstFrom.has(range.id)) firstFrom.set(range.id, range.from);
  const items: Item[] = threads.map((thread) => ({ key: thread.id, thread, from: firstFrom.get(thread.id) ?? 0 }));
  if (focus.draft) items.push({ key: DRAFT, thread: null, from: focus.draft.from });
  items.sort((left, right) => left.from - right.from);
  const activeKey = focus.draft ? DRAFT : focus.active;
  const order = items.map((item) => item.key).join(" ");

  const measure = useCallback(() => {
    const host = lane.current;
    if (!host || editor.isDestroyed) return;
    const base = host.getBoundingClientRect();
    const draft = commentFocusKey.getState(editor.state)?.draft ?? null;
    const anchorRect = (key: string): DOMRect | null => {
      if (key === DRAFT) {
        if (!draft) return null;
        const coords = editor.view.coordsAtPos(draft.from);
        return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
      }
      const element = editor.view.dom.querySelector(`[data-comment="${CSS.escape(key)}"]`);
      return element?.getClientRects()[0] ?? null;
    };
    const keys = order ? order.split(" ") : [];
    const rects = keys.map(anchorRect);
    const desired = rects.map((rect) => (rect ? rect.top - base.top - 6 : 0));
    const heights = keys.map((key) => cards.current.get(key)?.offsetHeight ?? 0);
    const result = placed(desired, heights, activeKey ? keys.indexOf(activeKey) : -1);
    const nextTops: Record<string, number> = Object.fromEntries(keys.map((key, index) => [key, Math.round(result[index])]));
    setTops((current) => (sameValues(current, nextTops) ? current : nextTops));
    const activeRect = activeKey ? rects[keys.indexOf(activeKey)] : null;
    const nextConnector = activeRect ? { left: Math.round(activeRect.right - base.left), top: Math.round(activeRect.bottom - base.top), width: Math.round(base.left - activeRect.right) } : null;
    setConnector((current) => (current && nextConnector && sameValues(current, nextConnector)) || current === nextConnector ? current : nextConnector);
  }, [editor, order, activeKey]);

  useLayoutEffect(measure);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    if (paper.current) observer.observe(paper.current);
    for (const card of cards.current.values()) observer.observe(card);
    editor.on("transaction", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off("transaction", schedule);
    };
  }, [editor, measure, paper, order]);

  const keep = (key: string) => (element: HTMLElement | null) => {
    if (element) cards.current.set(key, element);
    else cards.current.delete(key);
  };

  const author = () => useCommentsView.getState().author;
  const now = () => new Date().toISOString();
  const post = (text: string) => {
    if (documentThreads(editor.state.doc).length >= MAX_COMMENTS) {
      useToastStore.getState().push("error", t("studio.doc.comments.tooMany", { limit: MAX_COMMENTS }));
      return;
    }
    editor.chain().addComment({ id: newCommentId(), author: author(), createdAt: now(), text, resolved: false, replies: [] }).run();
  };
  const reply = (thread: CommentThread, text: string) => {
    if (thread.replies.length >= MAX_REPLIES) {
      useToastStore.getState().push("error", t("studio.doc.comments.tooManyReplies", { limit: MAX_REPLIES }));
      return;
    }
    editor.commands.updateComment(thread.id, (current) => ({ ...current, replies: [...current.replies, { id: newCommentId(), author: author(), createdAt: now(), text }] }));
  };

  return (
    <aside ref={lane} aria-label={t("studio.doc.comments.title")} className="relative shrink-0" style={{ width: COMMENT_LANE_WIDTH }} data-testid="comment-lane">
      {connector && connector.width > 0 ? <div className="pointer-events-none absolute h-0 border-t border-dashed border-primary/70" style={{ left: connector.left, top: connector.top, width: connector.width }} aria-hidden /> : null}
      {items.map((item) => (
        <div key={item.key} className="absolute inset-x-0" style={{ top: tops[item.key] ?? 0, visibility: item.key in tops ? undefined : "hidden" }}>
          {item.thread ? (
            <CommentCard
              ref={keep(item.key)}
              thread={item.thread}
              active={item.key === focus.active}
              onActivate={() => editor.chain().focus().selectComment(item.key).run()}
              onReply={(text) => reply(item.thread as CommentThread, text)}
              onEdit={(text) => editor.commands.updateComment(item.key, (current) => ({ ...current, text }))}
              onResolve={(resolved) => editor.commands.updateComment(item.key, (current) => ({ ...current, resolved }))}
              onRemove={() => editor.chain().focus().removeComment(item.key).run()}
            />
          ) : (
            <DraftCard ref={keep(DRAFT)} onPost={post} onCancel={() => editor.chain().focus().cancelComment().run()} />
          )}
        </div>
      ))}
    </aside>
  );
}

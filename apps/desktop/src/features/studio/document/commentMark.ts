import { Extension, Mark, mergeAttributes, type AnyExtension } from "@tiptap/core";
import type { Mark as ProseMark, Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { COMMENT, COMMENTS_ATTRIBUTE, commentId, commentThreads, type CommentThread } from "./comments";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      startComment: () => ReturnType;
      cancelComment: () => ReturnType;
      addComment: (thread: CommentThread) => ReturnType;
      updateComment: (id: string, change: (thread: CommentThread) => CommentThread) => ReturnType;
      removeComment: (id: string) => ReturnType;
      removeComments: (which: "resolved" | "all") => ReturnType;
      setActiveComment: (id: string | null) => ReturnType;
      selectComment: (id: string) => ReturnType;
    };
  }
}

export type CommentRange = { id: string; from: number; to: number; mark: ProseMark };
export type CommentFocus = { active: string | null; draft: { from: number; to: number } | null };

const WORD = /[\p{L}\p{N}_'’-]/u;
const EMPTY_FOCUS: CommentFocus = { active: null, draft: null };

export const commentFocusKey = new PluginKey<CommentFocus>("documentCommentFocus");

export function documentThreads(doc: ProseNode): CommentThread[] {
  return commentThreads(doc.attrs[COMMENTS_ATTRIBUTE]);
}

export function commentRanges(doc: ProseNode): CommentRange[] {
  const ranges: CommentRange[] = [];
  const latest = new Map<string, CommentRange>();
  doc.descendants((node, position) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== COMMENT) continue;
      const id = commentId(mark.attrs.id);
      if (!id) continue;
      const last = latest.get(id);
      if (last && last.to === position) last.to = position + node.nodeSize;
      else {
        const range = { id, from: position, to: position + node.nodeSize, mark };
        ranges.push(range);
        latest.set(id, range);
      }
    }
    return false;
  });
  return ranges;
}

export function orderedThreads(doc: ProseNode): CommentThread[] {
  const threads = documentThreads(doc);
  if (threads.length === 0) return threads;
  const first = new Map<string, number>();
  for (const range of commentRanges(doc)) if (!first.has(range.id)) first.set(range.id, range.from);
  return threads.filter((thread) => first.has(thread.id)).sort((left, right) => (first.get(left.id) ?? 0) - (first.get(right.id) ?? 0));
}

function commentAt(state: EditorState): string | null {
  const { $head } = state.selection;
  const marks = [...$head.marks(), ...($head.nodeAfter?.marks ?? [])];
  const found = marks.find((mark) => mark.type.name === COMMENT && commentId(mark.attrs.id));
  return found ? (found.attrs.id as string) : null;
}

function wordAround(state: EditorState): { from: number; to: number } | null {
  const { $from } = state.selection;
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, "￼");
  let start = $from.parentOffset;
  let end = $from.parentOffset;
  while (start > 0 && WORD.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD.test(text[end])) end += 1;
  if (start === end) return null;
  return { from: $from.start() + start, to: $from.start() + end };
}

function withThreads(tr: Transaction, threads: CommentThread[]): Transaction {
  return tr.setDocAttribute(COMMENTS_ATTRIBUTE, threads);
}

function stripComment(tr: Transaction, id: string): void {
  for (const range of commentRanges(tr.doc).filter((item) => item.id === id)) tr.removeMark(range.from, range.to, range.mark);
}

function decorations(state: EditorState): DecorationSet {
  const focus = commentFocusKey.getState(state) ?? EMPTY_FOCUS;
  const marks: Decoration[] = [];
  if (focus.active) for (const range of commentRanges(state.doc)) if (range.id === focus.active) marks.push(Decoration.inline(range.from, range.to, { class: "vp-comment-active" }));
  if (focus.draft && focus.draft.from < focus.draft.to) marks.push(Decoration.inline(focus.draft.from, focus.draft.to, { class: "vp-comment-draft" }));
  return marks.length ? DecorationSet.create(state.doc, marks) : DecorationSet.empty;
}

function cleaned(state: EditorState): Transaction | null {
  const threads = documentThreads(state.doc);
  const ranges = commentRanges(state.doc);
  if (threads.length === 0 && ranges.length === 0) return null;
  const anchored = new Set(ranges.map((range) => range.id));
  const known = new Set(threads.map((thread) => thread.id));
  const kept = threads.filter((thread) => anchored.has(thread.id));
  const strays = ranges.filter((range) => !known.has(range.id));
  const stored = state.doc.attrs[COMMENTS_ATTRIBUTE];
  if (strays.length === 0 && kept.length === threads.length && Array.isArray(stored) && stored.length === threads.length) return null;
  const tr = state.tr;
  for (const range of strays) tr.removeMark(range.from, range.to, range.mark);
  return withThreads(tr, kept);
}

const commentPlugin = new Plugin<CommentFocus>({
  key: commentFocusKey,
  state: {
    init: () => EMPTY_FOCUS,
    apply: (tr, value, _old, state) => {
      const meta = tr.getMeta(commentFocusKey) as Partial<CommentFocus> | undefined;
      let next = value;
      if (tr.docChanged && next.draft) {
        const from = tr.mapping.map(next.draft.from, 1);
        const to = tr.mapping.map(next.draft.to, -1);
        next = { ...next, draft: from < to ? { from, to } : null };
      }
      if (meta) return { ...next, ...meta };
      if (tr.selectionSet && !next.draft) {
        const active = commentAt(state);
        if (active !== next.active) next = { ...next, active };
      }
      if (next.active && !documentThreads(state.doc).some((thread) => thread.id === next.active)) next = { ...next, active: null };
      return next;
    },
  },
  props: { decorations },
  appendTransaction: (transactions, _old, state) => (transactions.some((tr) => tr.docChanged) ? cleaned(state) : null),
});

export const Comment = Mark.create({
  name: COMMENT,
  inclusive: false,
  excludes: "",
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => commentId(element.getAttribute("data-comment")),
        renderHTML: (attributes) => ({ "data-comment": commentId(attributes.id) ?? "" }),
      },
    };
  },
  parseHTML: () => [{ tag: "span[data-comment]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "vp-comment" }), 0],
  addKeyboardShortcuts() {
    return { "Mod-Alt-m": () => this.editor.commands.startComment() };
  },
  addCommands() {
    return {
      startComment:
        () =>
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = state.selection;
          const range = empty ? wordAround(state) : { from, to };
          if (!range || !state.doc.textBetween(range.from, range.to).trim()) return false;
          if (dispatch) tr.setMeta(commentFocusKey, { draft: range, active: null });
          return true;
        },
      cancelComment:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(commentFocusKey, { draft: null });
          return true;
        },
      addComment:
        (thread) =>
        ({ state, tr, dispatch }) => {
          const draft = commentFocusKey.getState(state)?.draft;
          if (!draft || !commentId(thread.id)) return false;
          if (dispatch) {
            tr.addMark(draft.from, draft.to, state.schema.marks[COMMENT].create({ id: thread.id }));
            withThreads(tr, [...documentThreads(state.doc), thread]).setMeta(commentFocusKey, { draft: null, active: thread.id });
          }
          return true;
        },
      updateComment:
        (id, change) =>
        ({ state, tr, dispatch }) => {
          const threads = documentThreads(state.doc);
          if (!threads.some((thread) => thread.id === id)) return false;
          if (dispatch) withThreads(tr, threads.map((thread) => (thread.id === id ? change(thread) : thread)));
          return true;
        },
      removeComment:
        (id) =>
        ({ state, tr, dispatch }) => {
          const threads = documentThreads(state.doc);
          if (!threads.some((thread) => thread.id === id)) return false;
          if (dispatch) {
            stripComment(tr, id);
            withThreads(tr, threads.filter((thread) => thread.id !== id)).setMeta(commentFocusKey, { active: null });
          }
          return true;
        },
      removeComments:
        (which) =>
        ({ state, tr, dispatch }) => {
          const threads = documentThreads(state.doc);
          const gone = threads.filter((thread) => which === "all" || thread.resolved);
          if (gone.length === 0) return false;
          if (dispatch) {
            for (const thread of gone) stripComment(tr, thread.id);
            withThreads(tr, threads.filter((thread) => !gone.includes(thread))).setMeta(commentFocusKey, { active: null });
          }
          return true;
        },
      setActiveComment:
        (id) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(commentFocusKey, { active: id });
          return true;
        },
      selectComment:
        (id) =>
        ({ state, tr, dispatch }) => {
          const range = commentRanges(state.doc).find((item) => item.id === id);
          if (!range) return false;
          if (dispatch) tr.setSelection(TextSelection.create(tr.doc, range.from)).setMeta(commentFocusKey, { active: id }).scrollIntoView();
          return true;
        },
    };
  },
  addProseMirrorPlugins: () => [commentPlugin],
});

export const CommentThreads = Extension.create({
  name: "commentThreads",
  addGlobalAttributes: () => [{ types: ["doc"], attributes: { [COMMENTS_ATTRIBUTE]: { default: [], rendered: false } } }],
});

export const commentExtensions = (): AnyExtension[] => [CommentThreads, Comment];

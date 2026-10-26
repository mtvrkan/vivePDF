import { useEditorState, type Editor } from "@tiptap/react";
import { commentFocusKey, orderedThreads, type CommentFocus } from "./commentMark";
import type { CommentThread } from "./comments";
import { useCommentsView } from "./commentsView";

export function useCommentState(editor: Editor | null): { threads: CommentThread[]; focus: CommentFocus } {
  return (
    useEditorState({
      editor,
      selector: ({ editor: current }) => (current ? { threads: orderedThreads(current.state.doc), focus: commentFocusKey.getState(current.state) ?? { active: null, draft: null } } : { threads: [], focus: { active: null, draft: null } }),
    }) ?? { threads: [], focus: { active: null, draft: null } }
  );
}

export function useCommentLaneOpen(editor: Editor | null): boolean {
  const shown = useCommentsView((state) => state.shown);
  const filled =
    useEditorState({
      editor,
      selector: ({ editor: current }) => (current ? Boolean(commentFocusKey.getState(current.state)?.draft) || orderedThreads(current.state.doc).length > 0 : false),
    }) ?? false;
  return shown && filled;
}

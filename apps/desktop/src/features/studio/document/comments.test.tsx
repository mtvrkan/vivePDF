import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import type { DocumentNode } from "@/types/studio";
import { storeCitationSource } from "./citationSource";
import { CommentLane } from "./CommentLane";
import { commentFocusKey, commentRanges, documentThreads, orderedThreads } from "./commentMark";
import { COMMENT_VERSION, MAX_COMMENT_AUTHOR, MAX_REPLIES, commentAuthor, commentThreads, commentTime, hasComments, initials, openCount, type CommentThread } from "./comments";
import { useCommentsView } from "./commentsView";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { DocumentToolbar } from "./DocumentToolbar";
import { fileVersion } from "./footnotes";
import { createDocument, normalizeDocument } from "./model";
import { documentHtml } from "./toHtml";

const FONTS = { fontId: "bundled:dejavu-sans", headingFontId: null };
const AT = "2026-10-26T09:00:00.000Z";

let editor: Editor | null = null;

function makeEditor(content: string | DocumentNode = "<p>Alpha beta gamma</p>") {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content });
  return editor;
}

function thread(id: string, text = "Check this", extra: Partial<CommentThread> = {}): CommentThread {
  return { id, author: "Esma", createdAt: AT, text, resolved: false, replies: [], ...extra };
}

function select(shown: Editor, from: number, to: number) {
  shown.view.dispatch(shown.state.tr.setSelection(TextSelection.create(shown.state.doc, from, to)));
}

function comment(shown: Editor, from: number, to: number, value: CommentThread) {
  select(shown, from, to);
  expect(shown.commands.startComment()).toBe(true);
  expect(shown.commands.addComment(value)).toBe(true);
}

function markedText(shown: Editor, id: string): string {
  return commentRanges(shown.state.doc)
    .filter((range) => range.id === id)
    .map((range) => shown.state.doc.textBetween(range.from, range.to))
    .join("|");
}

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  Element.prototype.scrollIntoView = () => undefined;
  vi.stubGlobal("ResizeObserver", NoResize);
});

beforeEach(() => {
  useDocumentStore.getState().open(createDocument("Thesis"));
  useCommentsView.setState({ shown: true, author: "Esma", naming: false });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
  useDocumentStore.getState().close();
});

describe("comment threads", () => {
  it("keeps well-formed threads and their replies", () => {
    const reply = { id: "c-r1", author: "Beril", createdAt: AT, text: "Done" };
    expect(commentThreads([{ ...thread("c-1"), resolved: true, replies: [reply] }])).toEqual([{ ...thread("c-1"), resolved: true, replies: [reply] }]);
  });

  it("drops threads with bad ids, empty text or a repeated id and clears a bad time", () => {
    const value = [thread("c-1"), { ...thread("c-1"), text: "again" }, thread("x-2"), { ...thread("c-3"), text: "  " }, { ...thread("c-4"), createdAt: "yesterday" }, null, "c-5"];
    expect(commentThreads(value)).toEqual([thread("c-1"), { ...thread("c-4"), createdAt: "" }]);
    expect(commentThreads("c-1")).toEqual([]);
  });

  it("caps replies and tidies the author name", () => {
    const replies = Array.from({ length: MAX_REPLIES + 5 }, (_, index) => ({ id: `c-r${index}`, author: "", createdAt: AT, text: "ok" }));
    expect(commentThreads([{ ...thread("c-1"), replies }])[0].replies).toHaveLength(MAX_REPLIES);
    expect(commentAuthor("  Nesibe \n Şafak ")).toBe("Nesibe Şafak");
    expect(commentAuthor("x".repeat(200))).toHaveLength(MAX_COMMENT_AUTHOR);
    expect(commentAuthor(42)).toBe("");
  });

  it("shows initials, open counts and times", () => {
    expect(initials("Nesibe Ayşe Şafak")).toBe("NŞ");
    expect(initials("esma")).toBe("E");
    expect(initials("")).toBe("?");
    expect(openCount([thread("c-1"), thread("c-2", "x", { resolved: true })])).toBe(1);
    expect(commentTime(AT, "en", new Date("2026-10-26T15:00:00.000Z"))).not.toMatch(/2026/);
    expect(commentTime(AT, "en", new Date("2026-11-02T15:00:00.000Z"))).toMatch(/2026/);
    expect(commentTime("", "en")).toBe("");
  });

  it("saves a document with comments as version 5", () => {
    const content: DocumentNode = { type: "doc", attrs: { comments: [thread("c-1")] }, content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "comment", attrs: { id: "c-1" } }] }] }] };
    expect(hasComments(content)).toBe(true);
    expect(hasComments({ type: "doc", attrs: { comments: [] } })).toBe(false);
    expect(fileVersion(content)).toBe(COMMENT_VERSION);
    expect(normalizeDocument({ kind: "document", version: 5, content })?.content).toEqual(content);
  });
});

describe("comment editing", () => {
  it("comments on the word around the cursor and keeps the thread in the document", () => {
    const shown = makeEditor();
    select(shown, 9, 9);
    expect(shown.commands.startComment()).toBe(true);
    expect(commentFocusKey.getState(shown.state)?.draft).toEqual({ from: 7, to: 11 });
    expect(shown.commands.addComment(thread("c-1"))).toBe(true);

    expect(markedText(shown, "c-1")).toBe("beta");
    expect(documentThreads(shown.state.doc)).toEqual([thread("c-1")]);
    expect(commentFocusKey.getState(shown.state)).toEqual({ active: "c-1", draft: null });
    expect((shown.getJSON() as DocumentNode).attrs?.comments).toEqual([thread("c-1")]);
  });

  it("refuses to start a comment on empty space and needs a draft to post", () => {
    const shown = makeEditor("<p>Alpha — beta</p>");
    select(shown, 7, 7);
    expect(shown.commands.startComment()).toBe(false);
    expect(shown.commands.addComment(thread("c-1"))).toBe(false);
    expect(documentThreads(shown.state.doc)).toEqual([]);
  });

  it("undoes and redoes a comment with its highlight", () => {
    const shown = makeEditor();
    comment(shown, 1, 6, thread("c-1"));
    shown.commands.undo();
    expect(documentThreads(shown.state.doc)).toEqual([]);
    expect(commentRanges(shown.state.doc)).toEqual([]);
    shown.commands.redo();
    expect(documentThreads(shown.state.doc)).toEqual([thread("c-1")]);
    expect(markedText(shown, "c-1")).toBe("Alpha");
  });

  it("drops a thread whose text is deleted and brings it back on undo", () => {
    const shown = makeEditor();
    comment(shown, 7, 11, thread("c-1"));
    shown.chain().deleteRange({ from: 6, to: 12 }).run();
    expect(documentThreads(shown.state.doc)).toEqual([]);
    shown.commands.undo();
    expect(documentThreads(shown.state.doc)).toEqual([thread("c-1")]);
    expect(markedText(shown, "c-1")).toBe("beta");
  });

  it("removes highlights that have no thread once the text changes", () => {
    const shown = makeEditor('<p><span data-comment="c-9">Alpha</span> beta</p>');
    expect(commentRanges(shown.state.doc)).toHaveLength(1);
    shown.chain().insertContentAt(12, "!").run();
    expect(commentRanges(shown.state.doc)).toEqual([]);
  });

  it("lets overlapping comments share text and orders them by position", () => {
    const shown = makeEditor();
    comment(shown, 7, 17, thread("c-b"));
    comment(shown, 1, 11, thread("c-a"));
    expect(orderedThreads(shown.state.doc).map((item) => item.id)).toEqual(["c-a", "c-b"]);
    expect(markedText(shown, "c-a")).toBe("Alpha beta");
    expect(markedText(shown, "c-b")).toBe("beta gamma");
  });

  it("updates, removes one and removes the resolved comments", () => {
    const shown = makeEditor();
    comment(shown, 1, 6, thread("c-1"));
    comment(shown, 7, 11, thread("c-2"));
    comment(shown, 12, 17, thread("c-3"));
    expect(shown.commands.updateComment("c-2", (current) => ({ ...current, resolved: true }))).toBe(true);
    expect(shown.commands.updateComment("c-404", (current) => current)).toBe(false);
    shown.commands.removeComments("resolved");
    expect(orderedThreads(shown.state.doc).map((item) => item.id)).toEqual(["c-1", "c-3"]);
    expect(markedText(shown, "c-2")).toBe("");
    shown.commands.removeComment("c-1");
    expect(orderedThreads(shown.state.doc).map((item) => item.id)).toEqual(["c-3"]);
    expect(shown.commands.removeComments("resolved")).toBe(false);
    shown.commands.removeComments("all");
    expect(documentThreads(shown.state.doc)).toEqual([]);
    expect(commentRanges(shown.state.doc)).toEqual([]);
  });

  it("selects a comment and makes it active", () => {
    const shown = makeEditor();
    comment(shown, 12, 17, thread("c-1"));
    select(shown, 1, 1);
    expect(commentFocusKey.getState(shown.state)?.active).toBeNull();
    expect(shown.commands.selectComment("c-1")).toBe(true);
    expect(shown.state.selection.from).toBe(12);
    expect(commentFocusKey.getState(shown.state)?.active).toBe("c-1");
    expect(shown.commands.selectComment("c-404")).toBe(false);
  });

  it("never writes comments into the PDF", () => {
    const shown = makeEditor();
    comment(shown, 1, 6, thread("c-1", "Private note"));
    const { html } = documentHtml(shown.getJSON() as DocumentNode, FONTS);
    expect(html).toContain("Alpha");
    expect(html).not.toContain("Private note");
    expect(html).not.toContain("data-comment");
  });
});

describe("comment lane and review tab", () => {
  it("asks for a selection when there is nothing to comment on", () => {
    const shown = makeEditor("<p></p>");
    render(<DocumentToolbar editor={shown} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByTestId("doc-comment-new"));
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/Select some text/);
    expect((screen.getByTestId("doc-comment-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("posts, replies to, resolves and deletes a comment from the lane", () => {
    const shown = makeEditor();
    vi.spyOn(shown.view, "coordsAtPos").mockReturnValue({ left: 0, right: 0, top: 0, bottom: 10 });
    render(
      <>
        <DocumentToolbar editor={shown} contentWidth={400} />
        <CommentLane editor={shown} paper={{ current: null }} />
      </>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    act(() => select(shown, 1, 6));
    fireEvent.click(screen.getByTestId("doc-comment-new"));
    fireEvent.change(screen.getByTestId("comment-draft-text"), { target: { value: "Source?" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    const [posted] = documentThreads(shown.state.doc);
    expect(posted).toMatchObject({ author: "Esma", text: "Source?", resolved: false, replies: [] });
    expect(screen.getByTestId("comment-card").textContent).toContain("Source?");

    fireEvent.change(screen.getByTestId("comment-reply-text"), { target: { value: "Added" } });
    fireEvent.keyDown(screen.getByTestId("comment-reply-text"), { key: "Enter", ctrlKey: true });
    expect(documentThreads(shown.state.doc)[0].replies.map((reply) => reply.text)).toEqual(["Added"]);

    fireEvent.click(screen.getByTestId("comment-resolve"));
    expect(documentThreads(shown.state.doc)[0].resolved).toBe(true);
    expect(screen.getByTestId("comment-card").textContent).toContain("Resolved");

    fireEvent.click(screen.getByTestId("comment-remove"));
    expect(documentThreads(shown.state.doc)).toEqual([]);
    expect(screen.queryByTestId("comment-card")).toBeNull();
  });

  it("asks for a name before the first comment when none is saved", () => {
    useCommentsView.setState({ author: "" });
    const shown = makeEditor();
    vi.spyOn(shown.view, "coordsAtPos").mockReturnValue({ left: 0, right: 0, top: 0, bottom: 10 });
    render(<CommentLane editor={shown} paper={{ current: null }} />);
    act(() => {
      select(shown, 1, 6);
      shown.commands.startComment();
    });
    fireEvent.change(screen.getByTestId("comment-draft-text"), { target: { value: "Why?" } });
    expect((screen.getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: " Beril  Ertuğrul " } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(documentThreads(shown.state.doc)[0].author).toBe("Beril Ertuğrul");
    expect(useCommentsView.getState().author).toBe("Beril Ertuğrul");
  });

  it("steps through comments and hides them from the review tab", () => {
    const shown = makeEditor();
    comment(shown, 1, 6, thread("c-1"));
    comment(shown, 12, 17, thread("c-2"));
    select(shown, 7, 7);
    render(<DocumentToolbar editor={shown} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByTestId("doc-comment-next"));
    expect(commentFocusKey.getState(shown.state)?.active).toBe("c-1");
    fireEvent.click(screen.getByTestId("doc-comment-next"));
    expect(commentFocusKey.getState(shown.state)?.active).toBe("c-2");
    fireEvent.click(screen.getByTestId("doc-comment-next"));
    expect(commentFocusKey.getState(shown.state)?.active).toBe("c-1");
    fireEvent.click(screen.getByTestId("doc-comment-previous"));
    expect(commentFocusKey.getState(shown.state)?.active).toBe("c-2");
    fireEvent.click(screen.getByTestId("doc-comments-shown"));
    expect(useCommentsView.getState().shown).toBe(false);
  });
});

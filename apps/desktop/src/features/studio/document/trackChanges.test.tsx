import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { ready, setLocale } from "@/app/i18n";
import type { DocumentNode } from "@/types/studio";
import { ChangesPanel } from "./ChangesPanel";
import { storeCitationSource } from "./citationSource";
import { useCommentsView } from "./commentsView";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { DocumentToolbar } from "./DocumentToolbar";
import { fileVersion } from "./footnotes";
import { createDocument, normalizeDocument } from "./model";
import { AuthorNameHost } from "./ReviewGroups";
import { ActiveChangeCard } from "./TrackChangeCard";
import { authorTone, BREAK_ATTRIBUTE, changeAttrs, finalContent, hasTrackedChanges, snippet, TRACK_CHANGES_VERSION } from "./trackChanges";
import { countText } from "./formatPainter";
import { documentMatches, replaceAllMatches } from "./findInDocument";
import { headingOutline } from "./headingOutline";
import { finalDocument, isTracking, trackedChanges, trackKey } from "./trackChangesMark";
import { useTrackChangesView } from "./trackChangesView";
import { documentHtml } from "./toHtml";

const FONTS = { fontId: "bundled:dejavu-sans", headingFontId: null };

let editor: Editor | null = null;

function makeEditor(content: string | DocumentNode = "<p>Alpha beta gamma</p>", tracking = true) {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content });
  if (tracking) editor.commands.setTrackChanges(true);
  return editor;
}

function select(shown: Editor, from: number, to = from) {
  shown.view.dispatch(shown.state.tr.setSelection(TextSelection.create(shown.state.doc, from, to)));
}

function type(shown: Editor, text: string) {
  const { from, to } = shown.state.selection;
  shown.view.dispatch(shown.state.tr.insertText(text, from, to));
}

function backspace(shown: Editor) {
  const head = shown.state.selection.head;
  shown.view.dispatch(shown.state.tr.delete(head - 1, head));
}

function marked(shown: Editor): string {
  const blocks: string[] = [];
  shown.state.doc.forEach((block) => {
    let line = "";
    block.descendants((node) => {
      if (!node.isText) return true;
      const names = node.marks.map((mark) => mark.type.name);
      const text = node.text ?? "";
      line += names.includes("deletion") ? `[-${text}]` : names.includes("insertion") ? `[+${text}]` : text;
      return false;
    });
    blocks.push(line);
  });
  return blocks.join("|");
}

function textAt(shown: Editor, text: string, nth = 0): number {
  let found = -1;
  let count = 0;
  shown.state.doc.descendants((node, position) => {
    if (found >= 0 || !node.isText) return found < 0;
    let index = (node.text ?? "").indexOf(text);
    while (index >= 0 && found < 0) {
      if (count === nth) found = position + index;
      count += 1;
      index = (node.text ?? "").indexOf(text, index + 1);
    }
    return false;
  });
  if (found < 0) throw new Error(`missing ${text}`);
  return found;
}

function remove(shown: Editor, text: string, nth = 0) {
  const at = textAt(shown, text, nth);
  shown.view.dispatch(shown.state.tr.delete(at, at + text.length));
}

function breaks(shown: Editor): string[] {
  const found: string[] = [];
  shown.state.doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const value = node.attrs[BREAK_ATTRIBUTE] as { type?: string } | null | undefined;
    found.push(value?.type ?? "-");
    return false;
  });
  return found;
}

function shape(shown: Editor): string {
  const walk = (node: Editor["state"]["doc"]): string => {
    if (node.isText) return node.text ?? "";
    let inner = "";
    node.forEach((child) => (inner += walk(child)));
    return node.isTextblock ? `(${inner})` : `${node.type.name}{${inner}}`;
  };
  return walk(shown.state.doc);
}

const FINAL_HTML = (shown: Editor) => documentHtml(shown.getJSON() as DocumentNode, FONTS).html.replace(/ id="[^"]*"/g, "");

beforeAll(async () => {
  await ready();
  await setLocale("en");
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  useDocumentStore.getState().open(createDocument("Thesis"));
  useCommentsView.setState({ shown: true, author: "Esma", naming: false });
  useTrackChangesView.setState({ view: "markup", panel: false, hiddenAuthors: [], pendingTrack: false });
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
  useDocumentStore.getState().close();
});

describe("tracked change data", () => {
  it("keeps valid change attributes and cleans the author", () => {
    expect(changeAttrs({ id: "r-a1", author: "  Esma   Y ", date: "2026-10-27T09:00:00.000Z" })).toEqual({ id: "r-a1", author: "Esma Y", date: "2026-10-27T09:00:00.000Z" });
  });

  it("drops a bad id and a bad date", () => {
    expect(changeAttrs({ id: "c-1", author: "Esma" })).toBeNull();
    expect(changeAttrs({ id: "r-1", author: "Esma", date: "yesterday" })?.date).toBe("");
  });

  it("gives each author a stable tone and shortens long snippets", () => {
    expect(authorTone(["Esma", "Beril"], "Beril")).toBe(1);
    expect(authorTone(["Esma"], "Nobody")).toBe(0);
    expect(snippet("a  b\nc")).toBe("a b c");
    expect(snippet("x".repeat(100), 10)).toHaveLength(10);
  });
});

describe("tracking edits", () => {
  it("leaves typing unmarked while tracking is off", () => {
    const shown = makeEditor(undefined, false);

    select(shown, 6);
    type(shown, "!");

    expect(marked(shown)).toBe("Alpha! beta gamma");
    expect(trackedChanges(shown.state.doc)).toEqual([]);
  });

  it("marks typed text as an insertion by the current author", () => {
    const shown = makeEditor();

    select(shown, 6);
    type(shown, " big");
    type(shown, "ger");

    expect(marked(shown)).toBe("Alpha[+ bigger] beta gamma");
    const [change] = trackedChanges(shown.state.doc);
    expect(change).toMatchObject({ kind: "insert", author: "Esma", inserted: " bigger" });
    expect(trackedChanges(shown.state.doc)).toHaveLength(1);
  });

  it("keeps backspaced text as one deletion and moves the cursor before it", () => {
    const shown = makeEditor();

    select(shown, 11);
    backspace(shown);
    backspace(shown);

    expect(marked(shown)).toBe("Alpha be[-ta] gamma");
    expect(shown.state.selection.head).toBe(9);
    expect(trackedChanges(shown.state.doc)).toHaveLength(1);
    expect(trackedChanges(shown.state.doc)[0]).toMatchObject({ kind: "delete", deleted: "ta" });
  });

  it("really removes the author's own pending insertion", () => {
    const shown = makeEditor();

    select(shown, 6);
    type(shown, "XY");
    backspace(shown);

    expect(marked(shown)).toBe("Alpha[+X] beta gamma");
  });

  it("shows replaced text before its replacement as one change", () => {
    const shown = makeEditor();

    select(shown, 7, 11);
    type(shown, "delta");

    expect(marked(shown)).toBe("Alpha [-beta][+delta] gamma");
    const changes = trackedChanges(shown.state.doc);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "replace", deleted: "beta", inserted: "delta" });
  });

  it("does not track joining two paragraphs", () => {
    const shown = makeEditor("<p>One</p><p>Two</p>");

    shown.view.dispatch(shown.state.tr.delete(4, 6));

    expect(marked(shown)).toBe("OneTwo");
  });

  it("undoes a tracked insertion without leaving marks behind", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");

    shown.commands.undo();

    expect(marked(shown)).toBe("Alpha beta gamma");
    expect(isTracking(shown.state.doc)).toBe(true);
  });
});

describe("accepting and rejecting", () => {
  it("accepts and rejects a replacement", () => {
    const shown = makeEditor();
    select(shown, 7, 11);
    type(shown, "delta");
    const [change] = trackedChanges(shown.state.doc);

    expect(shown.commands.acceptChange(change.id)).toBe(true);
    expect(marked(shown)).toBe("Alpha delta gamma");
    shown.commands.undo();
    expect(shown.commands.rejectChange(change.id)).toBe(true);
    expect(marked(shown)).toBe("Alpha beta gamma");
  });

  it("joins paragraphs again when a deletion across them is accepted", () => {
    const shown = makeEditor("<p>One two</p><p>three four</p>");

    shown.view.dispatch(shown.state.tr.delete(4, 15));
    expect(marked(shown)).toBe("One[- two]|[-three] four");
    shown.commands.acceptAllChanges();

    expect(marked(shown)).toBe("One four");
  });

  it("removes a wholly deleted paragraph on accept", () => {
    const shown = makeEditor("<p>Keep</p><p>Drop</p>");

    shown.view.dispatch(shown.state.tr.delete(6, 12));
    shown.commands.acceptAllChanges();

    expect(marked(shown)).toBe("Keep");
  });

  it("settles only the chosen authors", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");
    useCommentsView.setState({ author: "Beril" });
    select(shown, 18);
    type(shown, "?");

    shown.commands.rejectAllChanges(["Beril"]);

    expect(marked(shown)).toBe("Alpha[+!] beta gamma");
  });

  it("reports nothing to settle for an unknown change", () => {
    const shown = makeEditor();

    expect(shown.commands.acceptChange("r-missing")).toBe(false);
    expect(shown.commands.acceptAllChanges()).toBe(false);
  });
});

describe("saving and exporting", () => {
  it("saves tracked documents as version 6", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");

    expect(fileVersion(shown.getJSON() as DocumentNode)).toBe(TRACK_CHANGES_VERSION);
    expect(hasTrackedChanges({ type: "doc", attrs: { trackChanges: true }, content: [] })).toBe(true);
    expect(hasTrackedChanges({ type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
  });

  it("prints the final text and keeps revisions only for Word", () => {
    const shown = makeEditor("<p>Alpha beta gamma</p><p>Gone</p>");
    useCommentsView.setState({ author: 'A "B" <C>' });
    select(shown, 7, 11);
    type(shown, "delta");
    shown.view.dispatch(shown.state.tr.delete(25, 29));
    const content = shown.getJSON() as DocumentNode;

    const final = documentHtml(content, FONTS).html;
    const word = documentHtml(content, FONTS, null, false, true).html;

    expect(final).toContain("Alpha delta gamma");
    expect(final).not.toContain("beta");
    expect(final).not.toContain("Gone");
    expect(word).toContain('data-revision="del" data-author="A &quot;B&quot; &lt;C&gt;"');
    expect(word).toContain('data-revision="ins"');
    expect(finalContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] })).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] });
  });
});

describe("review tab, card and panel", () => {
  it("asks for a name before tracking and starts after it is saved", () => {
    useCommentsView.setState({ author: "" });
    const shown = makeEditor(undefined, false);
    render(
      <>
        <DocumentToolbar editor={shown} contentWidth={400} />
        <AuthorNameHost editor={shown} />
      </>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));

    fireEvent.click(screen.getByTestId("doc-track-toggle"));
    expect(isTracking(shown.state.doc)).toBe(false);
    fireEvent.change(screen.getByTestId("comment-author"), { target: { value: "Nesibe Şafak" } });
    fireEvent.click(screen.getByTestId("comment-author-save"));

    expect(isTracking(shown.state.doc)).toBe(true);
    expect(screen.getByTestId("doc-track-toggle").getAttribute("aria-pressed")).toBe("true");
  });

  it("steps to a change, opens its card and accepts it", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ left: 10, bottom: 20 }] as unknown as DOMRectList);
    render(
      <>
        <DocumentToolbar editor={shown} contentWidth={400} />
        <ActiveChangeCard editor={shown} language="en" />
      </>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));

    act(() => select(shown, 1));
    fireEvent.click(screen.getByTestId("doc-track-next"));
    expect(trackKey.getState(shown.state)?.active).toBe(trackedChanges(shown.state.doc)[0].id);
    fireEvent.click(screen.getByTestId("track-card-accept"));

    expect(marked(shown)).toBe("Alpha! beta gamma");
    expect(screen.queryByTestId("track-change-card")).toBeNull();
  });

  it("lists changes, filters by author and rejects all shown", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");
    useCommentsView.setState({ author: "Beril" });
    select(shown, 18);
    type(shown, "?");
    render(<ChangesPanel editor={shown} language="en" onTrack={() => undefined} />);
    expect(screen.getAllByTestId("changes-item")).toHaveLength(2);

    fireEvent.click(screen.getAllByTestId("changes-author")[0]);
    expect(screen.getAllByTestId("changes-item")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("changes-reject-all"));

    expect(marked(shown)).toBe("Alpha[+!] beta gamma");
  });

  it("offers to turn tracking on when there are no changes", () => {
    const shown = makeEditor(undefined, false);
    const onTrack = vi.fn();
    render(<ChangesPanel editor={shown} language="en" onTrack={onTrack} />);

    fireEvent.click(screen.getByTestId("changes-turn-on"));

    expect(onTrack).toHaveBeenCalledOnce();
  });

  it("closes the card with Escape", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");
    shown.commands.selectChange(trackedChanges(shown.state.doc)[0].id);

    shown.view.someProp("handleKeyDown", (handle) => handle(shown.view, new KeyboardEvent("keydown", { key: "Escape" })));

    expect(trackKey.getState(shown.state)?.active).toBeNull();
  });
});

describe("opening tracked files", () => {
  it("opens a version 6 document and keeps its marks", () => {
    const content = { type: "doc", attrs: { trackChanges: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "new", marks: [{ type: "insertion", attrs: { id: "r-1", author: "Esma", date: "" } }] }] }] };

    const opened = normalizeDocument({ ...createDocument("Thesis", content), version: TRACK_CHANGES_VERSION });

    expect(opened?.content).toEqual(content);
  });

  it("refuses a document from a newer version", () => {
    expect(normalizeDocument({ ...createDocument("Thesis"), version: TRACK_CHANGES_VERSION + 1 })).toBeNull();
  });
});

describe("deleting around pictures, tables and breaks", () => {
  it.each([[`<img src="data:image/png;base64,iVBORw0KGgo=">`], ["<table><tr><td><p>cell</p></td></tr></table>"], ["<div data-page-break></div>"], ["<hr>"]])("keeps the text and the block when a selection across %s is deleted", (middle) => {
    const shown = makeEditor(`<p>One two</p>${middle}<p>three four</p>`);
    const blocks = shown.state.doc.childCount;

    select(shown, textAt(shown, "two"), textAt(shown, "four") - 1);
    shown.view.dispatch(shown.state.tr.deleteSelection());

    expect(marked(shown)).toContain("One [-two]");
    expect(marked(shown)).toContain("[-three] four");
    expect(shown.state.doc.childCount).toBe(blocks);
    expect(trackedChanges(shown.state.doc).map((change) => change.deleted)).toEqual(["two" + "three"]);
  });

  it("accepts such a deletion without joining across the block", () => {
    const shown = makeEditor("<p>One two</p><hr><p>three four</p>");
    select(shown, textAt(shown, "two"), textAt(shown, "four") - 1);
    shown.view.dispatch(shown.state.tr.deleteSelection());

    shown.commands.acceptAllChanges();

    expect(shape(shown)).toMatch(/^doc\{\(One \)horizontalRule\{\}\( four\)/);
  });

  it("still deletes a lone picture outright", () => {
    const shown = makeEditor(`<p>One</p><img src="data:image/png;base64,iVBORw0KGgo="><p>Two</p>`);
    let picture = -1;
    shown.state.doc.forEach((node, offset) => {
      if (node.type.name === "image") picture = offset;
    });

    shown.view.dispatch(shown.state.tr.delete(picture, picture + 1));

    expect(shape(shown)).not.toContain("image");
    expect(trackedChanges(shown.state.doc)).toEqual([]);
  });
});

describe("settling changes keeps the structure", () => {
  it("does not join paragraphs for two separate edge deletions", () => {
    const shown = makeEditor("<p>One two</p><p>three four</p>");
    remove(shown, " two");
    remove(shown, "three");

    shown.commands.acceptAllChanges();

    expect(marked(shown)).toBe("One| four");
  });

  it("does not join paragraphs for two separate edge insertions on reject", () => {
    const shown = makeEditor("<p>One</p><p>Two</p>");
    select(shown, 4);
    type(shown, " end");
    select(shown, textAt(shown, "Two"));
    type(shown, "Start ");

    shown.commands.rejectAllChanges();

    expect(marked(shown)).toBe("One|Two");
  });

  it("keeps table rows and cells when cell deletions or insertions are settled", () => {
    const shown = makeEditor("<table><tr><td><p>a1</p></td><td><p>b1</p></td></tr><tr><td><p>a2</p></td><td><p>b2</p></td></tr></table>");
    remove(shown, "b1");
    remove(shown, "a2");
    shown.view.dispatch(shown.state.tr.insertText("X", textAt(shown, "a1") + 2));
    shown.view.dispatch(shown.state.tr.insertText("Y", textAt(shown, "b2")));

    shown.commands.acceptAllChanges();

    expect(shape(shown)).toContain("table{tableRow{tableCell{(a1X)}tableCell{()}}tableRow{tableCell{()}tableCell{(Yb2)}}}");
  });

  it("keeps cells apart when insertions in neighbouring cells are rejected", () => {
    const shown = makeEditor("<table><tr><td><p>a1</p></td><td><p>b1</p></td></tr></table>");
    shown.view.dispatch(shown.state.tr.insertText("X", textAt(shown, "a1") + 2));
    shown.view.dispatch(shown.state.tr.insertText("Y", textAt(shown, "b1")));

    shown.commands.rejectAllChanges();

    expect(shape(shown)).toContain("tableRow{tableCell{(a1)}tableCell{(b1)}}");
  });

  it("removes wholly deleted list items and joins items a deletion ran across", () => {
    const shown = makeEditor("<ul><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li><li><p>Four</p></li></ul>");
    remove(shown, "Two");
    select(shown, textAt(shown, "hree"), textAt(shown, "our"));
    shown.view.dispatch(shown.state.tr.deleteSelection());

    shown.commands.acceptAllChanges();

    expect(shape(shown)).toContain("bulletList{listItem{(One)}listItem{(Tour)}}");
  });

  it("marks the paragraph end a deletion runs across and restores it on reject", () => {
    const shown = makeEditor("<p>One two</p><p>three four</p>");
    shown.view.dispatch(shown.state.tr.delete(4, 15));
    expect(breaks(shown).slice(0, 2)).toEqual(["deletion", "-"]);

    shown.commands.rejectAllChanges();

    expect(marked(shown)).toBe("One two|three four");
    expect(breaks(shown).slice(0, 2)).toEqual(["-", "-"]);
  });

  it("moves the paragraph end mark along when a marked paragraph is split", () => {
    const shown = makeEditor("<p>One two</p><p>three four</p>");
    shown.view.dispatch(shown.state.tr.delete(4, 15));
    shown.commands.setTrackChanges(false);

    shown.view.dispatch(shown.state.tr.split(2));

    expect(marked(shown).split("|").slice(0, 3)).toEqual(["O", "ne[- two]", "[-three] four"]);
    expect(breaks(shown).slice(0, 3)).toEqual(["-", "deletion", "-"]);
  });
});

describe("final text everywhere", () => {
  it("shows the same text in Final export as after accepting all", () => {
    const shown = makeEditor("<h1>Title text</h1><p>Body text</p><ul><li><p>One</p></li><li><p>Two</p></li></ul><p>Keep</p><p>Drop</p><p>Tail</p>");
    select(shown, textAt(shown, "text"), textAt(shown, "text", 1));
    shown.view.dispatch(shown.state.tr.deleteSelection());
    select(shown, textAt(shown, "ne"), textAt(shown, "Two") + 1);
    shown.view.dispatch(shown.state.tr.deleteSelection());
    remove(shown, "Drop");
    const final = FINAL_HTML(shown);

    shown.commands.acceptAllChanges();

    expect(final).toBe(FINAL_HTML(shown));
    expect(final).toContain("<h1>Title text</h1><ul><li><p>Owo</p></li></ul><p>Keep</p><p>Tail</p>");
  });

  it("leaves an untouched document as it is", () => {
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] };

    expect(finalContent(content)).toBe(content);
  });

  it("keeps the only paragraph of a table cell when its text and end are deleted", () => {
    const content = { type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", attrs: { [BREAK_ATTRIBUTE]: { type: "deletion", id: "r-1", author: "Esma", date: "" } }, content: [{ type: "text", text: "x", marks: [{ type: "deletion", attrs: { id: "r-1" } }] }] }] }] }] }] };

    const cell = finalContent(content).content?.[0].content?.[0].content?.[0];

    expect(cell?.content).toEqual([{ type: "paragraph", attrs: { [BREAK_ATTRIBUTE]: null }, content: [] }]);
  });

  it("counts words, finds text and lists headings without deleted text", () => {
    const shown = makeEditor("<h1>Old title</h1><h2>Gone</h2><p>one two three two</p>");
    remove(shown, "Old ");
    select(shown, textAt(shown, "Gone"), textAt(shown, "one two"));
    shown.view.dispatch(shown.state.tr.deleteSelection());
    remove(shown, "two ");
    const { doc } = finalDocument(shown.state.doc);

    const words = countText(doc, 0, doc.content.size, "en").words;
    const matches = documentMatches(shown.state.doc, "two", { matchCase: false, wholeWord: false, language: "en" });
    const outline = headingOutline(shown.state.doc).map((heading) => heading.text);

    expect(words).toBe(4);
    expect(matches).toHaveLength(1);
    expect(outline).toEqual(["title"]);
  });

  it("replaces only live text with Replace all", () => {
    const shown = makeEditor("<p>Alpha beta gamma beta</p>");
    useCommentsView.setState({ author: "Beril" });
    remove(shown, "beta");
    useCommentsView.setState({ author: "Esma" });
    const matches = documentMatches(shown.state.doc, "beta", { matchCase: false, wholeWord: false, language: "en" });

    shown.view.dispatch(replaceAllMatches(shown.state.tr, matches, "BETA"));

    expect(marked(shown)).toBe("Alpha [-beta] gamma [-beta][+BETA]");
  });

  it("finds nothing when the only match is deleted", () => {
    const shown = makeEditor("<p>Alpha beta</p>");
    remove(shown, "beta");

    expect(documentMatches(shown.state.doc, "beta", { matchCase: false, wholeWord: false, language: "en" })).toEqual([]);
  });
});

function paste(shown: Editor, html: string) {
  shown.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
}

describe("pasting tracked text", () => {
  it("drops deleted text and renews change ids when tracking is off", () => {
    const shown = makeEditor();
    select(shown, 7, 11);
    type(shown, "delta");
    const id = trackedChanges(shown.state.doc)[0].id;
    shown.commands.setTrackChanges(false);
    select(shown, shown.state.doc.content.size - 1);

    paste(shown, `<p><span data-change="delete" data-change-id="${id}" data-author="Esma">beta</span><span data-change="insert" data-change-id="${id}" data-author="Esma">delta</span></p>`);

    const changes = trackedChanges(shown.state.doc);
    expect(marked(shown)).toBe("Alpha [-beta][+delta] gamma[+delta]");
    expect(new Set(changes.map((change) => change.id)).size).toBe(2);
  });

  it("marks pasted text as the paster's insertion without reviving deleted text", () => {
    const shown = makeEditor();
    useCommentsView.setState({ author: "Beril" });

    paste(shown, '<p>x<span data-change="delete" data-change-id="r-old" data-author="Esma">gone</span>y</p>');

    expect(marked(shown)).not.toContain("gone");
    expect(trackedChanges(shown.state.doc).every((change) => change.author === "Beril")).toBe(true);
  });

  it("pastes plain text unchanged when nothing is tracked", () => {
    const shown = makeEditor(undefined, false);
    select(shown, 6);

    paste(shown, "<p>!</p>");

    expect(marked(shown)).toBe("Alpha! beta gamma");
  });
});

describe("typing with an input method", () => {
  afterEach(() => vi.useRealTimers());

  function composing(shown: Editor, on: boolean) {
    (shown.view as unknown as { input: { composing: boolean } }).input.composing = on;
  }

  function endComposition(shown: Editor) {
    composing(shown, false);
    shown.view.someProp("handleDOMEvents", (handlers) => handlers.compositionend?.(shown.view, new Event("compositionend") as CompositionEvent));
    vi.advanceTimersByTime(100);
  }

  it("marks composed text only after the composition ends", () => {
    vi.useFakeTimers();
    const shown = makeEditor();
    select(shown, 6);
    composing(shown, true);

    type(shown, "k");
    shown.view.dispatch(shown.state.tr.insertText("ka", 6, 7));
    expect(trackedChanges(shown.state.doc)).toEqual([]);
    endComposition(shown);

    expect(marked(shown)).toBe("Alpha[+ka] beta gamma");
  });

  it("keeps the text a composition typed over as a deletion", () => {
    vi.useFakeTimers();
    const shown = makeEditor();
    composing(shown, true);

    shown.view.dispatch(shown.state.tr.insertText("x", 7, 11));
    endComposition(shown);

    expect(marked(shown)).toBe("Alpha [-beta][+x] gamma");
  });

  it("does nothing on a composition that changed nothing", () => {
    vi.useFakeTimers();
    const shown = makeEditor();
    composing(shown, true);
    shown.view.dispatch(shown.state.tr.insertText("x", 6, 6));
    shown.view.dispatch(shown.state.tr.delete(6, 7));

    endComposition(shown);

    expect(marked(shown)).toBe("Alpha beta gamma");
  });
});

describe("views, ribbon and card", () => {
  it("makes Final and Original read only and markup editable again", () => {
    const shown = makeEditor();

    act(() => useTrackChangesView.getState().setView("final"));
    const final = shown.view.editable;
    act(() => useTrackChangesView.getState().setView("original"));
    const original = shown.view.editable;
    act(() => useTrackChangesView.getState().setView("markup"));

    expect([final, original, shown.view.editable]).toEqual([false, false, true]);
  });

  it("accepts only the shown authors from the ribbon", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");
    useCommentsView.setState({ author: "Beril" });
    select(shown, 18);
    type(shown, "?");
    useTrackChangesView.setState({ hiddenAuthors: ["Esma"] });
    render(<DocumentToolbar editor={shown} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));

    fireEvent.click(screen.getByTestId("doc-track-accept"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Accept all changes" }));

    expect(marked(shown)).toBe("Alpha[+!] beta gamma?");
  });

  it("names the change kind for screen readers in the reviewing pane", () => {
    const shown = makeEditor();
    select(shown, 7, 11);
    type(shown, "delta");

    render(<ChangesPanel editor={shown} language="en" onTrack={() => undefined} />);

    expect(screen.getByTestId("changes-item").textContent).toContain("Replaced: ");
  });

  it("focuses the card when opened from the keyboard and returns focus on Escape", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ left: 10, bottom: 20 }] as unknown as DOMRectList);
    render(
      <>
        <DocumentToolbar editor={shown} contentWidth={400} />
        <ActiveChangeCard editor={shown} language="en" />
      </>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    const next = screen.getByTestId("doc-track-next");

    fireEvent.keyDown(next, { key: "Enter" });
    fireEvent.click(next);
    const card = screen.getByTestId("track-change-card");
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: "Escape" });

    expect(screen.queryByTestId("track-change-card")).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it("leaves focus in place when the card opens from a click", () => {
    const shown = makeEditor();
    select(shown, 6);
    type(shown, "!");
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ left: 10, bottom: 20 }] as unknown as DOMRectList);
    render(
      <>
        <DocumentToolbar editor={shown} contentWidth={400} />
        <ActiveChangeCard editor={shown} language="en" />
      </>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    const next = screen.getByTestId("doc-track-next");

    fireEvent.pointerDown(next);
    fireEvent.click(next);

    expect(document.activeElement).not.toBe(screen.getByTestId("track-change-card"));
  });
});

describe("Word export of paragraph ends and nested changes", () => {
  it("writes deleted paragraph ends and keeps deleted notes and line breaks inside the change", () => {
    const shown = makeEditor("<p>One two</p><p>three<br>four</p>");
    shown.view.dispatch(shown.state.tr.delete(4, 15));
    useCommentsView.setState({ author: "Beril" });
    select(shown, textAt(shown, "four"));
    shown.view.dispatch(shown.state.tr.delete(textAt(shown, "four") - 1, textAt(shown, "four")));

    const word = documentHtml(shown.getJSON() as DocumentNode, FONTS, null, false, true).html;

    expect(word).toContain('<p data-break-revision="del" data-break-author="Esma"');
    expect(word).toContain('<span data-revision="del" data-author="Beril"');
    expect(word).toMatch(/data-revision="del"[^>]*><br><\/span>/);
  });
});

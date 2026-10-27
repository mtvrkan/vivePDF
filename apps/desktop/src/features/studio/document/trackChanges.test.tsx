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
import { authorTone, changeAttrs, hasTrackedChanges, snippet, TRACK_CHANGES_VERSION, withoutDeleted } from "./trackChanges";
import { isTracking, trackedChanges, trackKey } from "./trackChangesMark";
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
    expect(withoutDeleted(content, true)).toEqual(content);
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

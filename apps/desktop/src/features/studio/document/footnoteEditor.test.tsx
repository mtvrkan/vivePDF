import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { CitationSource } from "./citationNodes";
import { noteContent, noteExtensions, noteValue } from "./footnoteEditor";
import { MAX_FOOTNOTE, MAX_FOOTNOTE_HTML, MAX_FOOTNOTE_LINES, MAX_FOOTNOTE_PICTURE, MAX_FOOTNOTE_PICTURES } from "./footnotes";

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";
const SOURCE: CitationSource = {
  current: () => ({ style: "apa", label: (items) => ({ text: `(${items.map((item) => item.key).join("; ")})`, missing: false }), references: [] }),
  title: () => "",
  emptyText: "",
  subscribe: () => () => undefined,
};

let editor: Editor | null = null;

function open(text: string, html = ""): Editor {
  editor = new Editor({ extensions: noteExtensions("", SOURCE), content: noteContent(text, html) });
  return editor;
}

function count(current: Editor, name: string): number {
  let found = 0;
  current.state.doc.descendants((node) => {
    if (node.type.name === name) found += 1;
  });
  return found;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("footnote editor", () => {
  it("reads plain text without markup and marked text with it", () => {
    expect(noteValue(open("a < b"))).toEqual({ text: "a < b", html: "" });
    expect(noteValue(open("x2", "x<sub>2</sub> <em>y</em>"))).toEqual({ text: "x2 y", html: "x<sub>2</sub> <em>y</em>" });
  });

  it("keeps the note on one line and within its length", () => {
    const current = open("one");
    current.commands.setTextSelection(4);

    current.commands.keyboardShortcut("Enter");
    current.commands.insertContent("x".repeat(MAX_FOOTNOTE));

    expect(current.state.doc.childCount).toBe(1);
    expect(current.getText()).toBe("one");
  });

  it("drops scripts, styles and unsafe links from stored markup", () => {
    const current = open("", '<script>bad()</script><a href="javascript:bad()">trap</a> <b onclick="bad()">ok</b> <span style="color:red">styled</span>');

    expect(current.state.doc.childCount).toBe(1);
    expect(noteValue(current)).toEqual({ text: "trap ok styled", html: "trap <strong>ok</strong> styled" });
    expect(noteContent("plain", "x".repeat(MAX_FOOTNOTE_HTML + 1))).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] });
  });

  it("starts a new line on Shift+Enter, keeps it in the plain text and reopens it", () => {
    const current = open("one");
    current.commands.setTextSelection(4);

    current.commands.keyboardShortcut("Shift-Enter");
    current.commands.insertContent("two");

    expect(current.state.doc.childCount).toBe(1);
    expect(noteValue(current)).toEqual({ text: "one\ntwo", html: "" });
    expect(count(open("one\ntwo"), "hardBreak")).toBe(1);
  });

  it("stores citations and pictures in the markup and drops unsafe pictures", () => {
    const current = open("", `See <span data-citation="[{&quot;key&quot;:&quot;knuth&quot;,&quot;locator&quot;:&quot;&quot;}]">old</span> <img src="${PIXEL}" alt="Logo"> <img src="https://example.org/x.png"> <img src="data:image/svg+xml;base64,PHN2Zz4=">`);

    const { text, html } = noteValue(current);

    expect(text).toBe("See (knuth)");
    expect(html).toContain('data-citation="[{&quot;key&quot;:&quot;knuth&quot;,&quot;locator&quot;:&quot;&quot;}]"');
    expect(html).toContain(`src="${PIXEL}"`);
    expect(count(current, "image")).toBe(1);
  });

  it("refuses more lines, more pictures or a larger picture than a note holds", () => {
    const current = open("x");
    current.commands.setTextSelection(2);

    for (let line = 0; line < MAX_FOOTNOTE_LINES + 3; line += 1) current.commands.setHardBreak();
    for (let picture = 0; picture < MAX_FOOTNOTE_PICTURES + 2; picture += 1) current.commands.setImage({ src: PIXEL });
    const pictures = count(current, "image");
    current.commands.setImage({ src: `data:image/png;base64,${"A".repeat(MAX_FOOTNOTE_PICTURE)}` });

    expect(count(current, "hardBreak")).toBe(MAX_FOOTNOTE_LINES - 1);
    expect(pictures).toBe(MAX_FOOTNOTE_PICTURES);
    expect(count(current, "image")).toBe(MAX_FOOTNOTE_PICTURES);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { noteContent, noteExtensions, noteValue } from "./footnoteEditor";
import { MAX_FOOTNOTE, MAX_FOOTNOTE_HTML } from "./footnotes";

let editor: Editor | null = null;

function open(text: string, html = ""): Editor {
  editor = new Editor({ extensions: noteExtensions(""), content: noteContent(text, html) });
  return editor;
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
});

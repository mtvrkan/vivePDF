import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { FootnotePanel } from "./FootnotePanel";
import { FOOTNOTE } from "./footnotes";

const TERMS = { and: "and", etAl: "et al.", page: "p.", pages: "pp.", noDate: "n.d.", in: "In", editor: "Ed.", editors: "Eds.", editedBy: "edited by", edition: "{ord} ed.", volume: "vol.", issue: "no.", doctoral: "Doctoral dissertation", masters: "Master's thesis", thesis: "Thesis", report: "Report No.", available: "Available" };

let editor: Editor | null = null;

function mount(content = "<p>ab</p>") {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource(TERMS, "en", "References", "")), content });
  render(<FootnotePanel editor={editor} />);
  return editor;
}

function notes(current: Editor): string[] {
  const found: string[] = [];
  current.state.doc.descendants((node) => {
    if (node.type.name === FOOTNOTE) found.push(String(node.attrs.text));
  });
  return found;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
});

describe("FootnotePanel", () => {
  it("opens on a new note, focuses its text and writes what is typed into the note", () => {
    const current = mount();
    current.commands.setTextSelection(2);

    act(() => {
      current.commands.insertFootnote();
    });
    const field = screen.getByRole("textbox", { name: "Footnote text" });
    fireEvent.change(field, { target: { value: "Source\nline" } });

    expect(screen.getByRole("region", { name: "Footnote 1" })).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect(notes(current)).toEqual(["Source line"]);
    expect(current.getText()).toBe("ab");
  });

  it("numbers the selected note by its place in the text", () => {
    const current = mount('<p>a<sup data-footnote="one"></sup>b<sup data-footnote="two"></sup></p>');

    act(() => {
      current.commands.setNodeSelection(4);
    });

    expect(screen.getByRole("region", { name: "Footnote 2" })).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Footnote text" }).value).toBe("two");
  });

  it("removes the note or returns to the text with Escape", () => {
    const current = mount('<p>a<sup data-footnote="one"></sup>b<sup data-footnote="two"></sup></p>');
    act(() => {
      current.commands.setNodeSelection(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove footnote" }));
    act(() => {
      current.commands.setNodeSelection(3);
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Footnote text" }), { key: "Escape" });

    expect(notes(current)).toEqual(["two"]);
    expect(screen.queryByTestId("footnote-panel")).toBeNull();
    expect(current.state.selection.from).toBe(4);
  });
});

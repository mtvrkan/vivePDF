import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import { parseBibtex } from "./bibtex";
import { storeCitationSource } from "./citationSource";
import { useDocumentStore } from "./documentStore";
import { createDocument } from "./model";
import { documentExtensions } from "./extensions";
import { FootnotePanel } from "./FootnotePanel";
import { FOOTNOTE } from "./footnotes";

const pictures = vi.hoisted(() => ({ pick: vi.fn(), shrink: vi.fn() }));
vi.mock("./documentFile", async (importOriginal) => ({ ...(await importOriginal<typeof import("./documentFile")>()), pickDocumentImage: (...args: unknown[]) => pictures.pick(...args) }));
vi.mock("./footnotePicture", () => ({ footnotePicture: (...args: unknown[]) => pictures.shrink(...args) }));

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

const TERMS = { and: "and", etAl: "et al.", page: "p.", pages: "pp.", noDate: "n.d.", in: "In", editor: "Ed.", editors: "Eds.", editedBy: "edited by", edition: "{ord} ed.", volume: "vol.", issue: "no.", doctoral: "Doctoral dissertation", masters: "Master's thesis", thesis: "Thesis", report: "Report No.", available: "Available" };

let editor: Editor | null = null;

function mount(content = "<p>ab</p>") {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource(TERMS, "en", "References", "")), content });
  render(<FootnotePanel editor={editor} />);
  return editor;
}

function noteEditor(field: HTMLElement): Editor {
  return (field as HTMLElement & { editor: Editor }).editor;
}

function markups(current: Editor): string[] {
  const found: string[] = [];
  current.state.doc.descendants((node) => {
    if (node.type.name === FOOTNOTE) found.push(String(node.attrs.html));
  });
  return found;
}

function notes(current: Editor): string[] {
  const found: string[] = [];
  current.state.doc.descendants((node) => {
    if (node.type.name === FOOTNOTE) found.push(String(node.attrs.text));
  });
  return found;
}

beforeAll(async () => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) });
  await ready();
  await setLocale("en");
});

afterEach(() => {
  cleanup();
  pictures.pick.mockReset();
  pictures.shrink.mockReset();
  useToastStore.setState({ toasts: [] });
  editor?.destroy();
  editor = null;
});

describe("FootnotePanel", () => {
  it("opens on a new note, focuses its text and writes what is typed into the note, line breaks included", () => {
    const current = mount();
    current.commands.setTextSelection(2);

    act(() => {
      current.commands.insertFootnote();
    });
    const field = screen.getByRole("textbox", { name: "Footnote text" });
    act(() => {
      noteEditor(field).commands.insertContent("Source\nline");
    });

    expect(screen.getByRole("region", { name: "Footnote 1" })).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect(notes(current)).toEqual(["Source\nline"]);
    expect(current.getText()).toBe("ab");
  });

  it("numbers the selected note by its place in the text", () => {
    const current = mount('<p>a<sup data-footnote="one"></sup>b<sup data-footnote="two"></sup></p>');

    act(() => {
      current.commands.setNodeSelection(4);
    });

    expect(screen.getByRole("region", { name: "Footnote 2" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Footnote text" }).textContent).toBe("two");
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

  it("writes formatting into the note while keeping a plain copy", () => {
    const current = mount('<p>a<sup data-footnote="Plain words"></sup>b</p>');
    act(() => {
      current.commands.setNodeSelection(2);
    });
    const field = screen.getByRole("textbox", { name: "Footnote text" });

    act(() => {
      noteEditor(field).commands.setTextSelection({ from: 1, to: 6 });
    });
    fireEvent.click(screen.getByRole("button", { name: /^Bold/ }));

    expect(notes(current)).toEqual(["Plain words"]);
    expect(markups(current)).toEqual(["<strong>Plain</strong> words"]);
    expect(current.getHTML()).toContain('data-footnote-html="<strong>Plain</strong> words"');
  });

  it("opens a formatted note with its marks and drops the markup when they are cleared", () => {
    const current = mount('<p>a<sup data-footnote="x2 site" data-footnote-html="x<sub>2</sub> <a href=&quot;https://example.org&quot;>site</a>"></sup></p>');
    act(() => {
      current.commands.setNodeSelection(2);
    });
    const field = screen.getByRole("textbox", { name: "Footnote text" });

    expect(field.querySelector("sub")?.textContent).toBe("2");
    expect(field.querySelector("a")?.getAttribute("href")).toBe("https://example.org");
    act(() => {
      noteEditor(field).chain().selectAll().unsetAllMarks().run();
    });

    expect(notes(current)).toEqual(["x2 site"]);
    expect(markups(current)).toEqual([""]);
    expect(current.getHTML()).not.toContain("data-footnote-html");
  });

  it("keeps the panel open when Escape closes the link dialog", () => {
    const current = mount('<p>a<sup data-footnote="note"></sup></p>');
    act(() => {
      current.commands.setNodeSelection(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.getByTestId("footnote-panel")).toBeTruthy();
  });

  it("puts a picked picture into the note at a footnote size", async () => {
    const current = mount('<p>a<sup data-footnote="Logo"></sup></p>');
    act(() => {
      current.commands.setNodeSelection(2);
    });
    pictures.pick.mockResolvedValue({ src: "data:image/png;base64,big", width: 900, height: 300 });
    pictures.shrink.mockResolvedValue(PIXEL);

    fireEvent.click(screen.getByRole("button", { name: "Insert picture" }));

    await waitFor(() => expect(markups(current)[0]).toContain(`src="${PIXEL}"`));
    expect(pictures.shrink).toHaveBeenCalledWith("data:image/png;base64,big");
    expect(screen.getByText("Shift+Enter starts a new line in the note.")).toBeTruthy();
  });

  it("says so and leaves the note alone when the picture is too large", async () => {
    const current = mount('<p>a<sup data-footnote="Logo"></sup></p>');
    act(() => {
      current.commands.setNodeSelection(2);
    });
    pictures.pick.mockResolvedValue({ src: "data:image/png;base64,huge", width: 9000, height: 9000 });
    pictures.shrink.mockResolvedValue(null);

    fireEvent.click(screen.getByRole("button", { name: "Insert picture" }));

    await waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain("This picture is too large for a footnote. Choose a smaller one."));
    expect(markups(current)).toEqual([""]);
  });

  it("cites a source inside the note through the sources dialog without offering a reference list", () => {
    const document = createDocument("Paper");
    useDocumentStore.getState().open({ ...document, sources: parseBibtex("@book{knuth, author={Knuth, Donald}, title={The Art of Computer Programming}, publisher={AW}, year=1968}").entries });
    const current = mount('<p>a<sup data-footnote="See"></sup></p>');
    act(() => {
      current.commands.setNodeSelection(2);
    });
    const field = screen.getByRole("textbox", { name: "Footnote text" });
    act(() => {
      noteEditor(field).commands.setTextSelection(4);
    });

    fireEvent.click(screen.getByRole("button", { name: "Insert citation" }));
    expect(screen.queryByTestId("cite-insert-list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /The Art of Computer Programming/ }));
    fireEvent.click(screen.getByTestId("cite-insert"));

    expect(markups(current)[0]).toContain("data-citation=");
    expect(markups(current)[0]).toContain("knuth");
    expect(field.querySelector(".vp-cite")?.textContent).toBe("(Knuth, 1968)");
  });
});

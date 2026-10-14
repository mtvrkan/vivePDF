import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { countText } from "./formatPainter";
import { FormatPainterButton } from "./FormatPainterButton";
import { WordCount } from "./WordCount";

const TERMS = { and: "and", etAl: "et al.", page: "p.", pages: "pp.", noDate: "n.d.", in: "In", editor: "Ed.", editors: "Eds.", editedBy: "edited by", edition: "{ord} ed.", volume: "vol.", issue: "no.", doctoral: "Doctoral dissertation", masters: "Master's thesis", thesis: "Thesis", report: "Report No.", available: "Available" };
const SOURCE = '<p style="text-align: center; line-height: 2"><strong><em>Styled</em></strong> plain</p><p>first target</p><p>second target</p>';

let editor: Editor | null = null;

function create(content: string): Editor {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource(TERMS, "en", "References", "")), content });
  return editor;
}

function select(current: Editor, from: number, to: number) {
  act(() => {
    current.commands.setTextSelection({ from, to });
  });
}

function paragraph(current: Editor, index: number) {
  return current.state.doc.child(index);
}

function paintOver(current: Editor, index: number) {
  let start = 0;
  current.state.doc.forEach((_child, offset, childIndex) => {
    if (childIndex === index) start = offset;
  });
  select(current, start + 1, start + 1 + paragraph(current, index).content.size);
  fireEvent.mouseUp(current.view.dom);
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
});

describe("format painter", () => {
  it("copies the marks and paragraph look once, then turns itself off", () => {
    const current = create(SOURCE);
    select(current, 2, 4);
    render(<FormatPainterButton editor={current} />);

    fireEvent.click(screen.getByTestId("doc-painter"));
    paintOver(current, 1);
    const painted = paragraph(current, 1);
    paintOver(current, 2);

    expect(painted.firstChild?.marks.map((mark) => mark.type.name).sort()).toEqual(["bold", "italic"]);
    expect(painted.attrs).toMatchObject({ textAlign: "center", lineHeight: 2 });
    expect(paragraph(current, 2).firstChild?.marks).toHaveLength(0);
    expect(screen.getByTestId("doc-painter").getAttribute("aria-pressed")).toBeNull();
  });

  it("keeps painting after a double click until Escape", () => {
    const current = create(SOURCE);
    select(current, 2, 4);
    render(<FormatPainterButton editor={current} />);

    fireEvent.doubleClick(screen.getByTestId("doc-painter"));
    paintOver(current, 1);
    paintOver(current, 2);
    const pressed = screen.getByTestId("doc-painter").getAttribute("aria-pressed");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(paragraph(current, 2).firstChild?.marks.map((mark) => mark.type.name).sort()).toEqual(["bold", "italic"]);
    expect(pressed).toBe("true");
    expect(screen.getByTestId("doc-painter").getAttribute("aria-pressed")).toBeNull();
  });

  it("removes formatting the target had when the source had none", () => {
    const current = create("<p>plain</p><p><u>under</u></p>");
    select(current, 2, 4);
    render(<FormatPainterButton editor={current} />);

    fireEvent.click(screen.getByTestId("doc-painter"));
    paintOver(current, 1);

    expect(paragraph(current, 1).firstChild?.marks).toHaveLength(0);
  });
});

describe("word count", () => {
  it("counts words and characters without counting paragraph breaks", () => {
    const current = create("<p>Bir iki, üç.</p><p>dört</p>");

    const counted = countText(current.state.doc, 0, current.state.doc.content.size, "tr");

    expect(counted).toEqual({ words: 4, characters: 16 });
  });

  it("shows the selection beside the total once typing settles", () => {
    vi.useFakeTimers();
    const current = create("<p>one two three four</p>");
    render(<WordCount editor={current} language="en" />);

    select(current, 1, 8);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByTestId("document-count").textContent).toBe("Words: 2 of 4 · Characters: 7");
  });
});

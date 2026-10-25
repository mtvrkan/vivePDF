import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { DocumentFindBar } from "./DocumentFindBar";
import { documentExtensions } from "./extensions";
import { documentMatches, findState } from "./findInDocument";

const OPTIONS = { matchCase: false, wholeWord: false, language: "en" };

let editor: Editor | null = null;

function create(content: string): Editor {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content });
  return editor;
}

function mount(content: string, replace = false, language = "en") {
  const current = create(content);
  let closed = 0;
  render(<DocumentFindBar editor={current} mode={{ replace, nonce: 1 }} language={language} onClose={() => (closed += 1)} />);
  return { current, closed: () => closed };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
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

describe("finding text in a document", () => {
  it("matches across bold and plain text inside one paragraph", () => {
    const current = create("<p>The <strong>sun</strong>ny day, sunny</p>");

    const matches = documentMatches(current.state.doc, "sunny", OPTIONS);

    expect(matches.map((match) => current.state.doc.textBetween(match.from, match.to))).toEqual(["sunny", "sunny"]);
  });

  it("honours whole words, case and Turkish dotted letters", () => {
    const current = create("<p>İstanbul istanbul ISTANBUL art cart</p>");

    const turkish = documentMatches(current.state.doc, "istanbul", { ...OPTIONS, language: "tr" });
    const cased = documentMatches(current.state.doc, "ISTANBUL", { ...OPTIONS, matchCase: true });
    const whole = documentMatches(current.state.doc, "art", { ...OPTIONS, wholeWord: true });

    expect(turkish).toHaveLength(2);
    expect(cased).toHaveLength(1);
    expect(whole).toHaveLength(1);
  });

  it("never matches across a line break or between paragraphs", () => {
    const current = create("<p>end<br>start</p><p>end</p><p>start</p>");

    const matches = documentMatches(current.state.doc, "endstart", OPTIONS);

    expect(matches).toHaveLength(0);
  });
});

describe("DocumentFindBar", () => {
  it("counts matches, steps through them and selects the current one", () => {
    const { current } = mount("<p>cat dog cat bird cat</p>");

    type("Find", "cat");
    const total = screen.getByRole("status").textContent;
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), { key: "Enter" });
    const { from, to } = current.state.selection;

    expect(total).toMatch(/3/);
    expect(screen.getByRole("status").textContent).toMatch(/2.*3/);
    expect(current.state.doc.textBetween(from, to)).toBe("cat");
    expect(from).toBe(9);
  });

  it("replaces all matches in one step that a single undo takes back", () => {
    const { current } = mount("<p>old <em>old</em> gold</p>", true);
    type("Find", "old");
    fireEvent.click(screen.getByRole("button", { name: "Whole words only" }));
    type("Replace with", "new");

    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    const replaced = current.getText();
    act(() => {
      current.commands.undo();
    });

    expect(replaced).toBe("new new gold");
    expect(current.getText()).toBe("old old gold");
    expect(current.getHTML()).toContain("<em>old</em>");
  });

  it("replaces the current match and moves on to the next", () => {
    const { current } = mount("<p>a1 a2 a3</p>", true);
    type("Find", "a");
    type("Replace with", "b");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(current.getText()).toBe("b1 a2 a3");
    expect(findState(current.state)?.matches).toHaveLength(2);
    expect(current.state.doc.textBetween(current.state.selection.from, current.state.selection.to)).toBe("a");
  });

  it("closes on Escape and clears the marks it drew", () => {
    const { current, closed } = mount("<p>cat</p>");
    type("Find", "cat");

    fireEvent.keyDown(screen.getByRole("search"), { key: "Escape" });
    cleanup();

    expect(closed()).toBe(1);
    expect(findState(current.state)?.matches).toHaveLength(0);
  });
});

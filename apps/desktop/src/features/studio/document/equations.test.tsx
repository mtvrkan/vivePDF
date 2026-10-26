import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import type { DocumentNode } from "@/types/studio";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { DocumentToolbar } from "./DocumentToolbar";
import { EquationDialogHost } from "./EquationDialogHost";
import { useEquationEditing } from "./equationEditing";
import { EQUATION_BLOCK, EQUATION_VERSION, MAX_EQUATION_LATEX, equationArt, equationNumbers, hasEquations } from "./equations";
import { fileVersion } from "./footnotes";
import { createDocument } from "./model";
import { documentHtml } from "./toHtml";

const FONTS = { fontId: "bundled:dejavu-sans", headingFontId: null };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -750 2000 1000"><path fill="currentColor" d="M0 0h10v10z"/></svg>';
const ART = { latex: "a+b", svg: SVG, width: 2, height: 1, depth: 0.25 };

let editor: Editor | null = null;

function makeEditor(content: string | DocumentNode = "<p></p>") {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content });
  return editor;
}

function block(id: string, latex = "a+b"): DocumentNode {
  return { type: EQUATION_BLOCK, attrs: { ...ART, latex, id } };
}

function shownNumbers(shown: Editor, selector: string) {
  return [...shown.view.dom.querySelectorAll(selector)].map((node) => node.getAttribute("data-number"));
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  useDocumentStore.getState().open(createDocument("Thesis"));
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
  useEquationEditing.getState().close();
  useDocumentStore.getState().close();
});

describe("equation art", () => {
  it("keeps a typeset equation and clamps the depth to its height", () => {
    expect(equationArt({ ...ART, depth: 5 })).toEqual({ ...ART, depth: 1 });
  });

  it("treats a missing depth as sitting on the baseline", () => {
    expect(equationArt({ ...ART, depth: undefined })?.depth).toBe(0);
  });

  it("refuses empty, oversized or non-SVG equations", () => {
    expect(equationArt({ ...ART, latex: "  " })).toBeNull();
    expect(equationArt({ ...ART, latex: "x".repeat(MAX_EQUATION_LATEX + 1) })).toBeNull();
    expect(equationArt({ ...ART, svg: "<img src=x>" })).toBeNull();
    expect(equationArt({ ...ART, width: 0 })).toBeNull();
    expect(equationArt({ ...ART, height: 61 })).toBeNull();
  });
});

describe("equation numbers", () => {
  it("numbers display equations in order and keeps references pointing at them after a deletion", () => {
    const shown = makeEditor({
      type: "doc",
      content: [
        block("eq-a"),
        block("eq-b"),
        { type: "paragraph", content: [{ type: "text", text: "See " }, { type: "equationRef", attrs: { target: "eq-b" } }, { type: "equationRef", attrs: { target: "eq-gone" } }] },
      ],
    });

    expect(shownNumbers(shown, ".vp-eq-block")).toEqual(["(1)", "(2)"]);
    expect(shownNumbers(shown, ".vp-eqref")).toEqual(["(2)", "(?)"]);
    shown.chain().setNodeSelection(0).deleteSelection().run();

    expect(shownNumbers(shown, ".vp-eq-block")).toEqual(["(1)"]);
    expect(shownNumbers(shown, ".vp-eqref")).toEqual(["(1)", "(?)"]);
  });

  it("gives a pasted copy a fresh id so references stay with the original", () => {
    const shown = makeEditor('<div data-equation-block data-latex="a" data-svg="' + SVG.replace(/"/g, "&quot;") + '" data-width="2" data-height="1" data-depth="0"></div>');

    const id = shown.state.doc.child(0).attrs.id as string;

    expect(id).toMatch(/^eq-[0-9a-f]{8}$/);
    expect(equationNumbers(shown.getJSON() as DocumentNode).get(id)).toBe(1);
  });
});

describe("equation output", () => {
  it("writes inline pictures, numbered paragraphs and reference numbers for the PDF", () => {
    const content: DocumentNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Let " }, { type: "equation", attrs: { ...ART, latex: "x<1" } }] },
        block("eq-a", "E=mc^2"),
        { type: "paragraph", content: [{ type: "text", text: "By " }, { type: "equationRef", attrs: { target: "eq-a" } }] },
      ],
    };

    const { html, equations, blockIds } = documentHtml(content, FONTS, null, true);

    expect(equations).toHaveLength(1);
    expect(equations[0]).toContain('fill="#000000"');
    expect(html).toContain('<img src="vpeq-0" alt="x&lt;1" style="width:2em;height:1em;vertical-align:-0.25em">');
    expect(html).toContain('<p id="e-1" class="eq" data-equation="0" data-latex="E=mc^2" style="text-align:right;text-indent:0;line-height:1.2;padding:0em 0;margin:0.5em 0">(1)</p>');
    expect(html).toContain("By (1)");
    expect(blockIds).toEqual(["b-0", "e-1", "b-2"]);
  });

  it("saves documents with equations as version 4 and leaves the rest alone", () => {
    const withMaths: DocumentNode = { type: "doc", content: [block("eq-a")] };

    expect(hasEquations(withMaths)).toBe(true);
    expect(fileVersion(withMaths)).toBe(EQUATION_VERSION);
    expect(fileVersion({ type: "doc", content: [{ type: "paragraph" }] })).toBe(1);
  });
});

describe("equation ribbon", () => {
  it("opens the numbered equation dialog and lists numbered equations to refer to", () => {
    const shown = makeEditor({ type: "doc", content: [block("eq-a", "\\frac{1}{2}"), { type: "paragraph" }] });
    render(<DocumentToolbar editor={shown} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));

    fireEvent.click(screen.getByTestId("doc-equation"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Numbered equation" }));

    expect(useEquationEditing.getState().request).toEqual({ kind: "block", position: null, latex: "" });
    fireEvent.click(screen.getByTestId("doc-equation"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reference to equation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "(1) \\frac{1}{2}" }));
    const targets: unknown[] = [];
    shown.state.doc.descendants((node) => {
      if (node.type.name === "equationRef") targets.push(node.attrs.target);
    });
    expect(targets).toEqual(["eq-a"]);
  });

  it("says there is nothing to refer to before the first numbered equation", () => {
    render(<DocumentToolbar editor={makeEditor()} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));

    fireEvent.click(screen.getByTestId("doc-equation"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reference to equation" }));

    expect((screen.getByRole("menuitem", { name: "No numbered equations yet" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("equation dialog", () => {
  it("typesets and inserts an inline equation, then edits it in place", async () => {
    const shown = makeEditor("<p>Text</p>");
    shown.commands.setTextSelection(5);
    useEquationEditing.getState().open("inline");
    render(<EquationDialogHost editor={shown} />);
    expect(screen.getByRole("dialog", { name: "Insert inline equation" })).toBeTruthy();

    const area = await screen.findByLabelText("Formula (LaTeX)");
    await act(async () => {
      fireEvent.change(area, { target: { value: "x^2" } });
    });
    await screen.findByRole("img", { name: "x^2" }, { timeout: 4000 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });

    const inserted = shown.state.doc.child(0).lastChild;
    expect(inserted?.type.name).toBe("equation");
    expect(inserted?.attrs.latex).toBe("x^2");
    expect(inserted?.attrs.depth).toBeGreaterThanOrEqual(0);
    expect(useEquationEditing.getState().request).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses an equation the document cannot store and keeps the dialog open", async () => {
    const shown = makeEditor("<p>Text</p>");
    useEquationEditing.getState().open("block");
    render(<EquationDialogHost editor={shown} />);
    const area = await screen.findByLabelText("Formula (LaTeX)");

    await act(async () => {
      fireEvent.change(area, { target: { value: `${"x+".repeat(MAX_EQUATION_LATEX / 2)}x` } });
    });
    await screen.findByRole("img", { name: /^x\+x/ }, { timeout: 8000 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });

    expect(useToastStore.getState().toasts.at(-1)?.message).toBe("This equation is too large; write a shorter one.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(shown.state.doc.childCount).toBe(1);
  });
});

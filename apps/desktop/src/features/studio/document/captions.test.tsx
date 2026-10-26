import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import type { DocumentNode } from "@/types/studio";
import { captionLabels } from "./captionNode";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { DocumentToolbar } from "./DocumentToolbar";
import { createDocument, layoutOf } from "./model";
import { documentHtml } from "./toHtml";

const FONTS = { fontId: "bundled:dejavu-sans", headingFontId: null };

let editor: Editor | null = null;

function makeEditor(content: string) {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content });
  return editor;
}

function blockNames(shown: Editor) {
  const names: string[] = [];
  shown.state.doc.forEach((node) => names.push(node.type.name));
  return names;
}

function shownNumbers(shown: Editor) {
  return [...shown.view.dom.querySelectorAll(".vp-caption-number")].map((number) => number.textContent);
}

const settings = () => useDocumentStore.getState().document!.settings;

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
  useDocumentStore.getState().close();
});

describe("captions", () => {
  it("puts a figure caption under the current block with the caret in it", () => {
    const shown = makeEditor("<p>Above</p><p>Below</p>");
    shown.commands.setTextSelection(2);

    shown.chain().insertCaption("figure", "Figure").insertContent("Site map").run();

    expect(blockNames(shown)).toEqual(["paragraph", "caption", "paragraph"]);
    expect(shown.state.doc.child(1).textContent).toBe("Site map");
  });

  it("puts a table caption above the table the caret is in", () => {
    const shown = makeEditor("<p>Intro</p><table><tr><td><p>Cell</p></td></tr></table>");
    shown.commands.setTextSelection(shown.state.doc.child(0).nodeSize + 4);

    shown.chain().insertCaption("table", "Table").run();

    expect(blockNames(shown)).toEqual(["paragraph", "caption", "table", "paragraph"]);
  });

  it("numbers figures and tables each on their own and renumbers after a deletion", () => {
    const shown = makeEditor(
      '<p data-caption="figure" data-label="Figure">A</p><p data-caption="table" data-label="Table">B</p><p data-caption="figure" data-label="Figure">C</p>',
    );

    expect(shownNumbers(shown)).toEqual(["Figure 1. ", "Table 1. ", "Figure 2. "]);
    shown.chain().setNodeSelection(0).deleteSelection().run();

    expect(shownNumbers(shown)).toEqual(["Table 1. ", "Figure 1. "]);
    expect([...captionLabels(shown.state.doc).values()]).toEqual(["Table 1.", "Figure 1."]);
  });

  it("writes numbered captions with their own ids for the PDF and the page lines", () => {
    const content: DocumentNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Text" }] },
        { type: "caption", attrs: { kind: "figure", label: "Şekil" }, content: [{ type: "text", text: "Map <1>" }] },
        { type: "caption", attrs: { kind: "table", label: "" } },
      ],
    };

    const { html, blockIds } = documentHtml(content, FONTS, null, true);

    expect(html).toContain('<p id="c-1" class="caption" data-caption="figure"><strong>Şekil 1.</strong> Map &lt;1&gt;</p>');
    expect(html).toContain('<p id="c-2" class="caption" data-caption="table"><strong>Table 1.</strong> </p>');
    expect(blockIds).toEqual(["b-0", "c-1", "c-2"]);
  });
});

describe("caption ribbon", () => {
  it("inserts a caption from References with the label in the app language", () => {
    const shown = makeEditor("<p>Picture</p>");
    render(<DocumentToolbar editor={shown} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "References" }));

    fireEvent.click(screen.getByTestId("doc-caption"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Table caption" }));

    expect(blockNames(shown)).toEqual(["paragraph", "caption", "paragraph"]);
    expect(shown.state.doc.child(1).attrs).toEqual({ kind: "table", label: "Table" });
  });

  it("turns the lists on and off and names them, with default titles for the PDF", () => {
    render(<DocumentToolbar editor={makeEditor("<p>Text</p>")} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "References" }));

    fireEvent.click(screen.getByTestId("doc-caption-lists"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "List of figures" }));
    expect(settings().figureList).toBe(true);
    expect(layoutOf(settings(), "Contents", { figure: "Şekiller listesi" }).figureListTitle).toBe("Şekiller listesi");

    fireEvent.click(screen.getByTestId("doc-caption-lists"));
    fireEvent.click(screen.getByRole("menuitem", { name: "List titles…" }));
    fireEvent.change(screen.getByTestId("doc-table-list-title"), { target: { value: "Tables" } });

    expect(settings().tableListTitle).toBe("Tables");
    expect(layoutOf(settings(), "Contents")).toMatchObject({ figureListTitle: "List of figures", tableListTitle: "Tables" });
  });
});

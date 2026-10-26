import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import type { DocumentNode } from "@/types/studio";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { useDocumentStore } from "./documentStore";
import { DocumentToolbar } from "./DocumentToolbar";
import { setHeadingNumbers } from "./headingNumbers";
import { createDocument, normalizeSettings } from "./model";
import { documentHtml } from "./toHtml";

const FRONT_AND_MAIN = "<h1>Abstract</h1><p>Summary</p><div data-page-break data-main=\"true\"></div><h1>Introduction</h1><h2>Scope</h2>";

let editor: Editor | null = null;

function makeEditor(content: string) {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", ""), undefined, "Main text starts here"), content });
  return editor;
}

function mainBreaks(shown: Editor) {
  const found: boolean[] = [];
  shown.state.doc.descendants((node) => {
    if (node.type.name === "pageBreak") found.push(node.attrs.main === true);
  });
  return found;
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
  useDocumentStore.getState().close();
});

describe("main text start", () => {
  it("is inserted from Layout › Breaks and labelled on the sheet", () => {
    const shown = makeEditor("<p>Preface</p>");
    render(<DocumentToolbar editor={shown} contentWidth={400} />);
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));

    fireEvent.click(screen.getByTestId("doc-main-matter"));

    expect(mainBreaks(shown)).toEqual([true]);
    expect(shown.view.dom.querySelector('[data-main="true"]')?.getAttribute("data-label")).toBe("Main text starts here");
  });

  it("keeps only the newest one when it is inserted twice", () => {
    const shown = makeEditor(FRONT_AND_MAIN);

    shown.chain().focus("end").setMainMatterBreak().run();

    expect(mainBreaks(shown)).toEqual([false, true]);
  });

  it("marks the first one in the PDF html and numbers only the headings after it", () => {
    const content: DocumentNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Abstract" }] },
        { type: "pageBreak", attrs: { main: true } },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Introduction" }] },
        { type: "pageBreak", attrs: { main: true } },
      ],
    };

    const { html } = documentHtml(content, { fontId: "bundled:dejavu-sans", headingFontId: null, headingNumbers: "plain" });

    expect(html).toBe('<h1 id="h-1">Abstract</h1><div class="page-break" data-main="true"></div><h1 id="h-2">1 Introduction</h1><div class="page-break"></div>');
  });

  it("leaves the front matter headings without numbers on the sheet", () => {
    const shown = makeEditor(FRONT_AND_MAIN);

    shown.view.dispatch(setHeadingNumbers(shown.state, "dotted"));

    expect([...shown.view.dom.querySelectorAll(".vp-heading-number")].map((item) => item.textContent)).toEqual(["1. ", "1.1. "]);
  });

  it("keeps the page number start a whole number between 1 and 9999", () => {
    expect(normalizeSettings({ pageNumberStart: 4.6 }).pageNumberStart).toBe(5);
    expect(normalizeSettings({ pageNumberStart: 0 }).pageNumberStart).toBe(1);
    expect(normalizeSettings({}).pageNumberStart).toBe(1);
  });
});

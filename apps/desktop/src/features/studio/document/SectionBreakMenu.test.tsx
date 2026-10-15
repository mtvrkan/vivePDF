import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import type { DocumentNode } from "@/types/studio";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { fileVersion } from "./footnotes";
import { createDocument } from "./model";
import { SectionBreakMenu } from "./SectionBreakMenu";
import { sectionColumns, sectionKind } from "./sections";
import { documentHtml } from "./toHtml";

const TERMS = { and: "and", etAl: "et al.", page: "p.", pages: "pp.", noDate: "n.d.", in: "In", editor: "Ed.", editors: "Eds.", editedBy: "edited by", edition: "{ord} ed.", volume: "vol.", issue: "no.", doctoral: "Doctoral dissertation", masters: "Master's thesis", thesis: "Thesis", report: "Report No.", available: "Available" };

let editor: Editor | null = null;

function mount(content: string) {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource(TERMS, "en", "References", ""), (columns, continuous) => `${continuous ? "Continuous" : "Section"} · ${columns}`), content });
  act(() => {
    editor?.commands.setTextSelection(2);
  });
  render(<SectionBreakMenu editor={editor} />);
  return editor;
}

function sectionBreaks(current: Editor): DocumentNode[] {
  return ((current.getJSON() as DocumentNode).content ?? []).filter((node) => node.type === "sectionBreak");
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

describe("SectionBreakMenu", () => {
  it("inserts a section break with the chosen column count", () => {
    const current = mount("<p>Intro</p>");

    fireEvent.click(screen.getByTestId("doc-section-break"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Section break: 3 columns" }));

    expect(sectionBreaks(current)).toEqual([{ type: "sectionBreak", attrs: { columns: 3 } }]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("inserts a continuous section break from the second group", () => {
    const current = mount("<p>Intro</p>");

    fireEvent.click(screen.getByTestId("doc-section-break"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Continuous section break: 2 columns" }));

    expect(sectionBreaks(current)).toEqual([{ type: "sectionBreak", attrs: { columns: 2, kind: "continuous" } }]);
    expect(current.view.dom.querySelector("[data-section-break]")?.getAttribute("data-label")).toBe("Continuous · 2");
  });

  it("reads a saved continuous break back and ignores unknown kinds", () => {
    const current = mount('<p>A</p><div data-section-break="" data-columns="3" data-kind="continuous"></div><p>B</p><div data-section-break="" data-columns="1" data-kind="odd"></div>');

    expect(sectionBreaks(current)).toEqual([
      { type: "sectionBreak", attrs: { columns: 3, kind: "continuous" } },
      { type: "sectionBreak", attrs: { columns: 1 } },
    ]);
    expect(current.view.dom.querySelector('[data-kind="continuous"]')).not.toBeNull();
    expect(sectionKind("continuous")).toBe("continuous");
    expect(sectionKind("page")).toBeUndefined();
  });

  it("reads saved breaks back and labels them in the editor", () => {
    const current = mount('<p>A</p><div data-section-break="" data-columns="1"></div><p>B</p>');

    const shown = current.view.dom.querySelector("[data-section-break]");

    expect(sectionBreaks(current)).toEqual([{ type: "sectionBreak", attrs: { columns: 1 } }]);
    expect(shown?.getAttribute("data-label")).toBe("Section · 1");
    expect(shown?.getAttribute("role")).toBe("separator");
  });

  it("falls back to two columns for an unknown count", () => {
    const current = mount('<p>A</p><div data-section-break="" data-columns="9"></div>');

    expect(sectionBreaks(current)[0]?.attrs).toEqual({ columns: 2 });
    expect(sectionColumns("3")).toBe(3);
    expect(sectionColumns(undefined)).toBe(2);
  });
});

describe("section break html", () => {
  const settings = createDocument("x").settings;

  it("writes the column count for the layout and keeps it in range", () => {
    const content: DocumentNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "sectionBreak", attrs: { columns: 3 } },
        { type: "sectionBreak", attrs: { columns: "<b>" } },
      ],
    };

    const { html } = documentHtml(content, settings);

    expect(html).toBe('<p>A</p><div class="section-break" data-columns="3"></div><div class="section-break" data-columns="2"></div>');
  });

  it("marks only continuous breaks for the layout", () => {
    const content: DocumentNode = {
      type: "doc",
      content: [
        { type: "sectionBreak", attrs: { columns: 2, kind: "continuous" } },
        { type: "sectionBreak", attrs: { columns: 1, kind: "\"><script>" } },
      ],
    };

    const { html } = documentHtml(content, settings);

    expect(html).toBe('<div class="section-break" data-columns="2" data-kind="continuous"></div><div class="section-break" data-columns="1"></div>');
  });

  it("saves documents with section breaks as version 2", () => {
    const content: DocumentNode = { type: "doc", content: [{ type: "sectionBreak", attrs: { columns: 1 } }] };

    expect(fileVersion(content)).toBe(2);
    expect(fileVersion('<div data-section-break="" data-columns="2"></div>')).toBe(2);
    expect(fileVersion({ type: "doc", content: [{ type: "pageBreak" }] })).toBe(1);
  });
});

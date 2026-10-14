import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import type { DocumentNode } from "@/types/studio";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { SpacingMenu } from "./SpacingMenu";
import { documentHtml } from "./toHtml";

const TERMS = { and: "and", etAl: "et al.", page: "p.", pages: "pp.", noDate: "n.d.", in: "In", editor: "Ed.", editors: "Eds.", editedBy: "edited by", edition: "{ord} ed.", volume: "vol.", issue: "no.", doctoral: "Doctoral dissertation", masters: "Master's thesis", thesis: "Thesis", report: "Report No.", available: "Available" };
const FONTS = { fontId: "bundled:dejavu-sans", headingFontId: null };

let editor: Editor | null = null;

function mount(content: string) {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource(TERMS, "en", "References", "")), content });
  act(() => {
    editor?.commands.setTextSelection(2);
  });
  render(<SpacingMenu editor={editor} />);
  return editor;
}

function firstAttrs(current: Editor): Record<string, unknown> {
  return current.state.doc.firstChild?.attrs ?? {};
}

function choose(name: string) {
  fireEvent.click(screen.getByTestId("doc-spacing"));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name }));
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

describe("paragraph spacing in the document", () => {
  it("sets a line spacing preset on the paragraph with the cursor", () => {
    const current = mount("<p>One</p><p>Two</p>");

    choose("1.5");

    expect(firstAttrs(current).lineHeight).toBe(1.5);
    expect(current.state.doc.child(1).attrs.lineHeight).toBeNull();
  });

  it("toggles space before, space after and a first line indent off again", () => {
    const current = mount("<p>One</p>");

    choose("Add space before paragraph");
    choose("Add space after paragraph");
    choose("Indent the first line");
    const set = { ...firstAttrs(current) };
    choose("Add space before paragraph");

    expect(set).toMatchObject({ spaceBefore: 12, spaceAfter: 12, firstLineIndent: 36 });
    expect(firstAttrs(current).spaceBefore).toBeNull();
    expect(firstAttrs(current).spaceAfter).toBe(12);
  });

  it("applies only the custom values that were moved and resets to the document spacing", () => {
    const current = mount("<h2>Title</h2>");
    fireEvent.click(screen.getByTestId("doc-spacing"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom spacing…" }));

    fireEvent.change(screen.getByRole("slider", { name: "Space before" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const applied = { ...firstAttrs(current) };
    fireEvent.click(screen.getByTestId("doc-spacing"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom spacing…" }));
    fireEvent.click(screen.getByRole("button", { name: "Use document spacing" }));

    expect(applied).toMatchObject({ spaceBefore: 30, spaceAfter: null, lineHeight: null });
    expect(firstAttrs(current)).toMatchObject({ spaceBefore: null, lineHeight: null });
  });

  it("reads spacing back from pasted HTML and keeps it within limits", () => {
    const current = mount('<p style="line-height: 9; margin-top: 16px; text-indent: 18pt">One</p>');

    const attrs = firstAttrs(current);

    expect(attrs).toMatchObject({ lineHeight: 3, spaceBefore: 12, firstLineIndent: 18 });
  });

  it("writes the spacing into the exported HTML beside the alignment", () => {
    const content: DocumentNode = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { textAlign: "center", lineHeight: 2, spaceBefore: 0, spaceAfter: 99, firstLineIndent: "x" }, content: [{ type: "text", text: "A" }] },
        { type: "heading", attrs: { level: 2, firstLineIndent: 36 }, content: [{ type: "text", text: "B" }] },
      ],
    };

    const { html } = documentHtml(content, FONTS);

    expect(html).toContain('<p style="text-align:center;line-height:2;margin-top:0pt;margin-bottom:48pt">A</p>');
    expect(html).toContain('<h2 id="h-1" style="text-indent:36pt">B</h2>');
  });
});

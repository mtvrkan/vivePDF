import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { documentExtensions } from "./extensions";
import { pageBreaks, wordsPosition } from "./pageBreaks";
import type { LaidOut } from "./useDocumentLayout";

const schema = getSchema(documentExtensions("", { citations: () => null, references: () => null } as never));

function layout(partial: Partial<LaidOut>): LaidOut {
  return { token: "t", pageCount: 3, width: 595, height: 842, blockStarts: [], pageStarts: [], blockIds: [], ...partial };
}

function doc(paragraphs: string[]): ProseMirrorNode {
  return ProseMirrorNode.fromJSON(schema, { type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });
}

describe("page lines", () => {
  it("breaks before a block that opens a page and inside one that runs over", () => {
    const laid = layout({
      blockIds: ["h-1", "b-1", "b-2"],
      blockStarts: [
        { id: "h-1", page: 1, top: 56 },
        { id: "b-1", page: 1, top: 90 },
        { id: "b-2", page: 3, top: 56 },
      ],
      pageStarts: [
        { page: 2, top: 57, words: ["dolor", "sit", "amet"] },
        { page: 3, top: 57, words: ["Next", "part"] },
      ],
    });

    const breaks = pageBreaks(laid);

    expect(breaks).toEqual([
      { page: 2, block: 1, words: ["dolor", "sit", "amet"] },
      { page: 3, block: 2, words: null },
    ]);
  });

  it("leaves out the cover and contents pages before the first block", () => {
    const laid = layout({
      blockIds: ["b-0"],
      blockStarts: [{ id: "b-0", page: 3, top: 56 }],
      pageStarts: [
        { page: 2, top: 60, words: ["Contents"] },
        { page: 3, top: 56, words: ["Hello"] },
      ],
    });

    expect(pageBreaks(laid)).toEqual([]);
  });

  it("finds the first words of a page inside a block, across marks and punctuation", () => {
    const node = ProseMirrorNode.fromJSON(schema, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First." }] },
        { type: "paragraph", content: [{ type: "text", text: "Lorem ipsum " }, { type: "text", marks: [{ type: "bold" }], text: "dolor" }, { type: "text", text: " sit, amet." }] },
      ],
    });

    const position = wordsPosition(node, 1, ["dolor", "sit,", "amet."]);

    expect(position).not.toBeNull();
    expect(node.textBetween(position as number, (position as number) + 5)).toBe("dolor");
  });

  it("gives no position when the words are not in the block", () => {
    expect(wordsPosition(doc(["One two three"]), 0, ["four", "five"])).toBeNull();
    expect(wordsPosition(doc(["One"]), 4, ["One"])).toBeNull();
  });
});

describe("marked blocks", () => {
  it("gives each top-level block an id for the layout and leaves page breaks unmarked", async () => {
    const { documentHtml } = await import("./toHtml");
    const content = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }, { type: "paragraph", content: [{ type: "text", text: "Body" }] }, { type: "pageBreak" }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }] }] }] };

    const marked = documentHtml(content, { fontId: "", headingFontId: null }, null, true);

    expect(marked.blockIds).toEqual(["h-1", "b-1", "", "b-3"]);
    expect(marked.html).toContain('<p id="b-1">Body</p>');
    expect(marked.html).toContain('<ul id="b-3">');
    expect(documentHtml(content, { fontId: "", headingFontId: null }).html).not.toContain('id="b-');
  });
});

import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import en from "@/locales/en/common.json";
import type { DocumentNode } from "@/types/studio";
import { createDocument, defaultSettings, layoutOf, normalizeDocument, normalizeSettings, pageSize } from "./model";
import { buildStarter, DOCUMENT_STARTERS } from "./starters";
import { documentHtml } from "./toHtml";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function text(value: string, marks: DocumentNode["marks"] = []): DocumentNode {
  return { type: "text", text: value, marks };
}

function doc(...content: DocumentNode[]): DocumentNode {
  return { type: "doc", content };
}

const settings = { fontId: "bundled:dejavu-sans", headingFontId: null };

describe("documentHtml", () => {
  it("writes headings with ids, aligned paragraphs, marks and escaped text", () => {
    const content = doc(
      { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [text("Intro")] },
      { type: "paragraph", attrs: { textAlign: "justify" }, content: [text("a < b & "), text("bold", [{ type: "bold" }, { type: "italic" }]), text(" x", [{ type: "textStyle", attrs: { color: "#ff0000", fontSize: "14pt" } }])] },
      { type: "paragraph" },
    );

    const { html } = documentHtml(content, settings);

    expect(html).toBe(
      '<h2 id="h-1" style="text-align:center">Intro</h2>' +
        '<p style="text-align:justify">a &lt; b &amp; <em><strong>bold</strong></em><span style="color:#ff0000;font-size:14pt"> x</span></p>' +
        "<p>&nbsp;</p>",
    );
  });

  it("collects pictures once and fonts by first use, keeping body and heading fonts first", () => {
    const content = doc(
      { type: "image", attrs: { src: PNG, width: 200 } },
      { type: "image", attrs: { src: PNG } },
      { type: "image", attrs: { src: "C:/secret.png" } },
      { type: "paragraph", content: [text("A", [{ type: "textStyle", attrs: { fontId: "library:lora" } }]), text("B", [{ type: "textStyle", attrs: { fontId: "bundled:dejavu-sans" } }])] },
    );

    const result = documentHtml(content, { fontId: "bundled:dejavu-sans", headingFontId: "library:inter" });

    expect(result.images).toEqual([PNG]);
    expect(result.fonts).toEqual(["bundled:dejavu-sans", "library:inter", "library:lora"]);
    expect(result.html).toContain('<img src="vpimg-0" style="width:150pt">');
    expect(result.html.match(/vpimg-0/g)).toHaveLength(2);
    expect(result.html).not.toContain("secret");
    expect(result.html).toContain('<span style="font-family:f2">A</span><span style="font-family:f0">B</span>');
  });

  it("keeps safe links only and ignores unknown colours and sizes", () => {
    const content = doc({
      type: "paragraph",
      content: [
        text("ok", [{ type: "link", attrs: { href: "https://example.com/?a=1&b=2" } }]),
        text("bad", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
        text("odd", [{ type: "textStyle", attrs: { color: "red; background:url(x)", fontSize: "999pt" } }]),
      ],
    });

    const { html } = documentHtml(content, settings);

    expect(html).toBe('<p><a href="https://example.com/?a=1&amp;b=2">ok</a>badodd</p>');
  });

  it("writes lists, checklists, tables, code, page breaks and right-to-left paragraphs", () => {
    const content = doc(
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("three")] }] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [text("done")] }] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, colwidth: [100] }, content: [{ type: "paragraph", content: [text("H")] }] }] }] },
      { type: "codeBlock", content: [text("if a < b:\n  pass")] },
      { type: "pageBreak" },
      { type: "paragraph", content: [text("مرحبا")] },
    );

    const { html } = documentHtml(content, settings);

    expect(html).toContain('<ol start="3"><li><p>three</p></li></ol>');
    expect(html).toContain('<ul class="tasks"><li><p>&#9745; done</p></li></ul>');
    expect(html).toContain('<th colspan="2" style="width:75pt"><p>H</p></th>');
    expect(html).toContain("<pre><code>if a &lt; b:\n  pass</code></pre>");
    expect(html).toContain('<div class="page-break"></div>');
    expect(html).toContain('<p dir="rtl">مرحبا</p>');
  });
});

describe("document model", () => {
  it("clamps settings and drops what it does not know", () => {
    const settings = normalizeSettings({ marginMm: 500, fontSize: 2, paper: "a0", accent: "red", tocDepth: 7, pageNumbers: "outside", header: "x".repeat(500), extra: true });

    expect(settings.marginMm).toBe(50);
    expect(settings.fontSize).toBe(6);
    expect(settings.paper).toBe("a4");
    expect(settings.accent).toBe(defaultSettings().accent);
    expect(settings.tocDepth).toBe(2);
    expect(settings.pageNumbers).toBe("outside");
    expect(settings.header).toHaveLength(200);
    expect(settings).not.toHaveProperty("extra");
  });

  it("refuses files that are not documents or come from a newer version", () => {
    expect(normalizeDocument({ kind: "design", version: 1 })).toBeNull();
    expect(normalizeDocument({ kind: "document", version: 99 })).toBeNull();
    expect(normalizeDocument({ kind: "document", version: 1, content: 5 })?.content).toBe("");
  });

  it("turns the page for landscape and leaves the font ids out of the layout", () => {
    const document = createDocument("x", "", { paper: "a5", landscape: true, headingFontId: "library:lora" });

    expect(pageSize(document.settings)).toEqual({ width: 595, height: 420 });
    expect(layoutOf(document.settings, "Contents")).not.toHaveProperty("fontId");
    expect(layoutOf(document.settings, "Contents")).not.toHaveProperty("headingFontId");
    expect(layoutOf(document.settings, "Contents").tocTitle).toBe("Contents");
  });
});

describe("document starters", () => {
  const lookup = (key: string) => key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), en);
  const t = ((key: string) => {
    const value = lookup(key);
    if (typeof value !== "string") throw new Error(`missing ${key}`);
    return value;
  }) as unknown as TFunction;

  it("builds every starter from existing strings with escaped text", () => {
    for (const starter of DOCUMENT_STARTERS) {
      const document = buildStarter(starter, t, "en");

      expect(document.kind).toBe("document");
      expect(typeof document.content).toBe("string");
      expect(document.content as string).not.toMatch(/<script|undefined/);
    }
  });

  it("gives the report a cover and contents and the booklet A5 pages", () => {
    expect(buildStarter("report", t, "en").settings).toMatchObject({ cover: true, toc: true });
    expect(buildStarter("booklet", t, "en").settings).toMatchObject({ paper: "a5", cover: true });
    expect(buildStarter("blank", t, "en").content).toBe("");
  });
});

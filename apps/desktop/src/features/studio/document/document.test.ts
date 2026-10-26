import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import en from "@/locales/en/common.json";
import type { DocumentNode } from "@/types/studio";
import { parseBibtex } from "./bibtex";
import { documentContent, documentText } from "./content";
import { contentInsets, createDocument, defaultSettings, layoutOf, normalizeDocument, normalizeSettings, pageSize, POINTS_PER_MM, uniformMargin, uniformMargins } from "./model";
import { buildStarter, DOCUMENT_STARTERS } from "./starters";
import { fileVersion, MAX_FOOTNOTE_HTML, MAX_FOOTNOTE_PICTURE } from "./footnotes";
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

describe("footnotes", () => {
  const footnote = (value: string): DocumentNode => ({ type: "footnote", attrs: { text: value } });

  it("numbers the markers in reading order and collects their tidied text", () => {
    const content = doc(
      { type: "paragraph", content: [text("One"), footnote("  First\n note "), text(" two")] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [text("Cell"), footnote("Second")] }] }] }] },
    );

    const { html, footnotes } = documentHtml(content, settings);

    expect(html).toContain('<p>One<sup class="fn-ref" id="fnref-1">1</sup> two</p>');
    expect(html).toContain('Cell<sup class="fn-ref" id="fnref-2">2</sup>');
    expect(footnotes).toEqual(["First\nnote", "Second"]);
  });

  it("leaves note text raw for the sidecar to escape and still numbers an empty note", () => {
    const { html, footnotes } = documentHtml(doc({ type: "paragraph", content: [footnote("<b>x</b>"), footnote("")] }), settings);

    expect(html).toBe('<p><sup class="fn-ref" id="fnref-1">1</sup><sup class="fn-ref" id="fnref-2">2</sup></p>');
    expect(footnotes).toEqual(["<b>x</b>", ""]);
  });

  it("sends each note's formatting beside its plain text, empty for plain notes", () => {
    const formatted: DocumentNode = { type: "footnote", attrs: { text: "x2", html: " x<sub>2</sub> " } };
    const oversized: DocumentNode = { type: "footnote", attrs: { text: "long", html: "b".repeat(MAX_FOOTNOTE_HTML + 1) } };

    const { footnotes, footnoteHtml } = documentHtml(doc({ type: "paragraph", content: [formatted, footnote("plain"), oversized] }), settings);

    expect(footnotes).toEqual(["x2", "plain", "long"]);
    expect(footnoteHtml).toEqual(["x<sub>2</sub>", "", ""]);
  });

  it("saves a document with notes as version 2 and one without as version 1", () => {
    const plain = doc({ type: "paragraph", content: [text("x")] });
    const noted = doc({ type: "paragraph", content: [text("x"), footnote("n")] });

    expect(fileVersion(plain)).toBe(1);
    expect(fileVersion(noted)).toBe(2);
    expect(fileVersion("")).toBe(1);
    expect(normalizeDocument({ kind: "document", version: 2, content: noted })?.content).toEqual(noted);
    expect(normalizeDocument({ kind: "document", version: 6, content: noted })).toBeNull();
  });

  it("saves notes with line breaks, citations or pictures as version 3 and still reads version 2", () => {
    const rich = (attrs: Record<string, unknown>) => doc({ type: "paragraph", content: [text("x"), { type: "footnote", attrs }] });
    const older = doc({ type: "paragraph", content: [text("x"), { type: "footnote", attrs: { text: "n", html: "<em>n</em>" } }] });

    expect(fileVersion(rich({ text: "a\nb" }))).toBe(3);
    expect(fileVersion(rich({ text: "a", html: `<img src="${PNG}">` }))).toBe(3);
    expect(fileVersion(rich({ text: "a", html: '<span data-citation="[]">a</span>' }))).toBe(3);
    expect(fileVersion(older)).toBe(2);
    expect(fileVersion('<p>x<sup data-footnote="n" data-footnote-html="a&lt;br&gt;b"></sup></p>')).toBe(3);
    expect(normalizeDocument({ kind: "document", version: 2, content: older })?.content).toEqual(older);
  });

  it("resolves footnote citations and pictures before the sidecar sees them", async () => {
    const sources = parseBibtex("@book{knuth, author={Knuth, Donald}, title={The Art}, publisher={AW}, year=1968}").entries;
    const cited = '<span data-citation="[{&quot;key&quot;:&quot;knuth&quot;,&quot;locator&quot;:&quot;3&quot;}]" class="vp-cite">stale</span>';
    const note: DocumentNode = { type: "footnote", attrs: { text: "See stale", html: `See ${cited} <img src="${PNG}" alt="Lo&quot;go" class="x"><br>next <img src="https://example.org/x.png"> <img src="data:image/bmp;base64,Qk0=">` } };
    const body = { type: "image", attrs: { src: PNG } };
    const document = { ...createDocument("Paper", doc({ type: "paragraph", content: [text("Claim"), note] }, body as DocumentNode)), sources };
    const t = ((key: string) => key) as unknown as TFunction;

    const written = await documentContent(document, "en", documentText(t));

    expect(written.footnoteHtml).toEqual(['See (Knuth, 1968, p. 3) <img src="vpimg-0" alt="Lo&quot;go"><br>next  ']);
    expect(written.images).toEqual([PNG]);
    expect(written.footnotes).toEqual(["See stale"]);
  });

  it("sends a note whose pictures break the limits as plain text", () => {
    const huge = `data:image/png;base64,${"A".repeat(MAX_FOOTNOTE_PICTURE)}`;
    const note: DocumentNode = { type: "footnote", attrs: { text: "Logo", html: `<b>Logo</b> <img src="${huge}">` } };

    const { footnoteHtml, images } = documentHtml(doc({ type: "paragraph", content: [note] }), settings);

    expect(footnoteHtml).toEqual([""]);
    expect(images).toEqual([]);
  });

  it("saves imported html that carries notes as version 2", () => {
    expect(fileVersion('<p>Claim<sup data-footnote="Source"></sup></p>')).toBe(2);
    expect(fileVersion("<p>No notes [^1]</p>")).toBe(1);
  });
});

describe("document model", () => {
  it("clamps settings and drops what it does not know", () => {
    const settings = normalizeSettings({ marginMm: 500, fontSize: 2, paper: "a0", accent: "red", tocDepth: 7, pageNumbers: "outside", header: "x".repeat(500), extra: true });

    expect(settings).toMatchObject({ marginTopMm: 60, marginBottomMm: 60, marginLeftMm: 60, marginRightMm: 60 });
    expect(settings.fontSize).toBe(6);
    expect(settings.paper).toBe("a4");
    expect(settings.accent).toBe(defaultSettings().accent);
    expect(settings.tocDepth).toBe(2);
    expect(settings.pageNumbers).toBe("outside");
    expect(settings.header).toHaveLength(200);
    expect(settings).not.toHaveProperty("extra");
  });

  it("spreads an old single margin to every side and lets a side of its own win", () => {
    const settings = normalizeSettings({ marginMm: 25, marginLeftMm: 35 });

    expect(settings).toMatchObject({ marginTopMm: 25, marginBottomMm: 25, marginLeftMm: 35, marginRightMm: 25, gutterMm: 0, gutterSide: "left" });
    expect(settings).not.toHaveProperty("marginMm");
  });

  it("keeps the gutter within its limits and on a known side", () => {
    expect(normalizeSettings({ gutterMm: 99, gutterSide: "top" })).toMatchObject({ gutterMm: 30, gutterSide: "top" });
    expect(normalizeSettings({ gutterMm: -4, gutterSide: "right" })).toMatchObject({ gutterMm: 0, gutterSide: "left" });
  });

  it("adds the gutter to the side it sits on", () => {
    const insets = contentInsets({ ...uniformMargins(10), gutterMm: 5, gutterSide: "top" });

    expect(insets.top).toBeCloseTo(15 * POINTS_PER_MM);
    expect(insets.left).toBeCloseTo(10 * POINTS_PER_MM);
    expect(uniformMargin({ ...uniformMargins(10), gutterMm: 5 })).toBeNull();
    expect(uniformMargin({ ...uniformMargins(10), gutterMm: 0 })).toBe(10);
  });

  it("keeps one to three columns and a gap within its limits", () => {
    const two = normalizeSettings({ columns: 2, columnGapMm: 99 });
    const odd = normalizeSettings({ columns: 5, columnGapMm: "wide" });

    expect(two).toMatchObject({ columns: 2, columnGapMm: 20 });
    expect(odd).toMatchObject({ columns: 1, columnGapMm: 8 });
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

  it("lays out the thesis starters on the 4 cm left margin with roman front pages", () => {
    const masters = buildStarter("mastersThesis", t, "en");
    const phd = buildStarter("phdThesis", t, "en");

    expect(masters.settings).toMatchObject({ paper: "a4", marginLeftMm: 40, marginRightMm: 25, fontSize: 12, lineHeight: 1.5, pageNumbers: "center", accent: "#000000", cover: true, toc: true, headingNumbers: "dotted" });
    expect(masters.settings.subtitle).toBe(en.studio.doc.starters.thesis.masters);
    expect(phd.settings.subtitle).toBe(en.studio.doc.starters.thesis.phd);
    expect((masters.content as string).match(/data-main="true"/g)).toHaveLength(1);
    expect(masters.content as string).toContain("text-indent:35.43pt");
    expect(masters.content as string).toMatch(/<div data-bibliography><\/div>$/);
  });
});

describe("citations in the document", () => {
  const lookup = (key: string) => key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), en);
  const t = ((key: string) => {
    const value = lookup(key);
    if (typeof value !== "string") throw new Error(`missing ${key}`);
    return value;
  }) as unknown as TFunction;
  const sources = parseBibtex("@book{knuth, author={Knuth, Donald}, title={The Art}, publisher={AW}, year=1968}").entries;
  const content = doc(
    { type: "heading", attrs: { level: 1 }, content: [text("Intro")] },
    { type: "paragraph", content: [text("As shown "), { type: "citation", attrs: { items: [{ key: "knuth", locator: "7" }] } }] },
    { type: "bibliography" },
  );

  it("writes citation labels and a reference list whose heading joins the contents", async () => {
    const document = { ...createDocument("Paper", content), sources };

    const written = await documentContent(document, "en", documentText(t));
    const titled = await documentContent({ ...document, settings: { ...document.settings, referencesTitle: "Works cited", citationStyle: "ieee" } }, "en", documentText(t));

    expect(written.html).toContain("<p>As shown (Knuth, 1968, p. 7)</p>");
    expect(written.html).toContain('<div class="references"><h1 id="h-2">References</h1><p class="ref">Knuth, D. (1968). <i>The Art</i>. AW.</p></div>');
    expect(titled.html).toContain("<p>As shown [1, p. 7]</p>");
    expect(titled.html).toContain('<h1 id="h-2">Works cited</h1>');
    expect(written.settings).not.toHaveProperty("citationStyle");
    expect(written.settings).not.toHaveProperty("referencesTitle");
  });

  it("leaves an empty reference list out of the export", async () => {
    const document = createDocument("Paper", doc({ type: "bibliography" }));

    expect((await documentContent(document, "en", documentText(t))).html).toBe("");
  });

  it("keeps sources through a save and falls back to APA for an unknown style", () => {
    const stored = JSON.parse(JSON.stringify({ ...createDocument("Paper", content), sources, settings: { ...defaultSettings(), citationStyle: "oxford" } }));

    const document = normalizeDocument(stored);

    expect(document?.sources).toEqual(sources);
    expect(document?.settings.citationStyle).toBe("apa");
    expect(createDocument("New").sources).toEqual([]);
  });
});

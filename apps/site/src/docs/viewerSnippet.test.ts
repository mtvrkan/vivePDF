import { describe, expect, it } from "vitest";
import { VIEWER_CDN, VIEWER_DEFAULTS, viewerAttributes, viewerSnippet } from "./viewerSnippet";

const copy = { src: "/files/document.pdf", open: "Open the PDF" };

describe("viewer snippet", () => {
  it("writes only the script and the source when every setting is left as it is", () => {
    const snippet = viewerSnippet(VIEWER_DEFAULTS, copy);

    expect(snippet).toBe(`<script src="${VIEWER_CDN}"></script>\n<vive-pdf src="/files/document.pdf"></vive-pdf>`);
  });

  it("adds each changed setting and turns hidden controls into false", () => {
    const attributes = viewerAttributes({ ...VIEWER_DEFAULTS, mode: "inline", page: 3, zoom: "150", theme: "auto", lang: "tr", accent: "#7C3AED", hidden: ["print", "search"] });

    expect(attributes).toEqual([["mode", "inline"], ["page", "3"], ["zoom", "150"], ["theme", "auto"], ["lang", "tr"], ["accent", "#7C3AED"], ["search", "false"], ["print", "false"]]);
  });

  it("gives the lightbox a button that opens it", () => {
    const snippet = viewerSnippet({ ...VIEWER_DEFAULTS, mode: "lightbox" }, copy);

    expect(snippet).toContain('<button type="button" id="open-pdf">Open the PDF</button>');
    expect(snippet).toContain('<vive-pdf id="pdf" src="/files/document.pdf" mode="lightbox"></vive-pdf>');
    expect(snippet).toContain('document.getElementById("pdf").show()');
  });

  it("escapes quotes and markup in values", () => {
    const snippet = viewerSnippet(VIEWER_DEFAULTS, { src: '/a"b<c&d.pdf', open: "<b>" });

    expect(snippet).toContain('src="/a&quot;b&lt;c&amp;d.pdf"');
  });
});

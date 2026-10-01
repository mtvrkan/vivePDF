import { describe, expect, it } from "vitest";
import { HTML_STYLE_PROPERTIES, SVG_STYLE_PROPERTIES, detachedRootStyle, htmlAnnotationRoots, htmlSnapshotMarkup, inlineImageSources, loadingImages, styledSnapshotClone, svgSnapshotMarkup, usedFontFamilies } from "./lensComposition";

function fromMarkup(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  return host;
}

describe("lens snapshots", () => {
  it("copies class-driven svg styles onto the clone without touching the page", () => {
    const host = fromMarkup('<svg class="ink"><path class="stroke" d="M0 0L5 5"/></svg>');
    const svg = host.querySelector("svg") as SVGSVGElement;
    const colours = new Map<Element, Record<string, string>>([[svg.querySelector("path") as Element, { stroke: "rgb(255, 0, 0)", "stroke-width": "3px" }]]);
    const clone = styledSnapshotClone(svg, SVG_STYLE_PROPERTIES, (element) => ({ getPropertyValue: (property) => colours.get(element)?.[property] ?? "" }));
    expect(clone.querySelector("path")?.getAttribute("style")).toBe("stroke:rgb(255, 0, 0);stroke-width:3px");
    expect(clone.getAttribute("style")).toBeNull();
    expect(svg.querySelector("path")?.getAttribute("style")).toBeNull();
    host.remove();
  });

  it("keeps existing inline styles and lets computed values win", () => {
    const host = fromMarkup('<div style="position:absolute;color:blue">Metin</div>');
    const source = host.firstElementChild as HTMLElement;
    const clone = styledSnapshotClone(source, HTML_STYLE_PROPERTIES, () => ({ getPropertyValue: (property) => (property === "color" ? "rgb(0, 128, 0)" : "") }));
    expect(clone.getAttribute("style")).toBe("position:absolute;color:blue;color:rgb(0, 128, 0)");
    expect(detachedRootStyle(clone.getAttribute("style")).endsWith("position:static;left:auto;top:auto;margin:0;transform:none")).toBe(true);
    host.remove();
  });

  it("finds free-text annotations but not svg text, buttons or nested parts", () => {
    const host = fromMarkup(
      '<div data-annotation-layer><div class="free"><div class="box"><span>Merhaba</span> <b>dünya</b></div></div><svg><text>ink</text></svg><button>Sil</button><div class="empty"> </div></div>',
    );
    const layer = host.querySelector("[data-annotation-layer]") as Element;
    const roots = htmlAnnotationRoots(layer);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.className).toBe("free");
    host.remove();
  });

  it("wraps html in a scaled foreignObject so the lens stays sharp", () => {
    const url = htmlSnapshotMarkup('<div xmlns="http://www.w3.org/1999/xhtml">a</div>', 40, 20, 3);
    const markup = decodeURIComponent(url.replace("data:image/svg+xml;charset=utf-8,", ""));
    expect(markup).toContain('viewBox="0 0 40 20" width="120" height="60"');
    expect(markup).toContain('<foreignObject x="0" y="0" width="40" height="20">');
    expect(markup).toContain(">a</div>");
  });

  it("lists every font family named in the cloned styles", () => {
    const host = fromMarkup(`<div style="font-family:&quot;vp-font-abc&quot;, sans-serif"><span style="font-family:'vp-embedded-4-doc'">a</span><b>b</b></div>`);
    expect(usedFontFamilies(host.firstElementChild as Element)).toEqual(["vp-font-abc", "sans-serif", "vp-embedded-4-doc"]);
    host.remove();
  });

  it("puts font faces inside the snapshot so the lens draws the chosen font", () => {
    const rule = '@font-face{font-family:"vp-font-abc";src:url(data:font/ttf;base64,AAEAAA==)}';
    const html = decodeURIComponent(htmlSnapshotMarkup("<span>a</span>", 10, 10, 1, rule));
    expect(html).toContain(`overflow:hidden"><style>${rule}</style><span>a</span>`);
    const svg = decodeURIComponent(svgSnapshotMarkup('<svg viewBox="0 0 1 1"><text>a</text></svg>', 10, 10, rule));
    expect(svg).toContain(`height="10"><style>${rule}</style><text>`);
    expect(decodeURIComponent(htmlSnapshotMarkup("<span>a</span>", 10, 10, 1))).not.toContain("<style>");
  });

  it("swaps image sources for data urls and leaves unreadable ones alone", () => {
    const host = fromMarkup('<div><img src="stamp.png"><img src="blocked.png"></div>');
    const source = host.firstElementChild as Element;
    const clone = source.cloneNode(true) as Element;
    inlineImageSources(source, clone, (image) => (image.getAttribute("src") === "stamp.png" ? "data:image/png;base64,AA==" : null));
    expect(Array.from(clone.querySelectorAll("img")).map((image) => image.getAttribute("src"))).toEqual(["data:image/png;base64,AA==", "blocked.png"]);
    expect(source.querySelector("img")?.getAttribute("src")).toBe("stamp.png");
    host.remove();
  });

  it("reports images still loading so a snapshot is not taken without them", () => {
    const host = fromMarkup('<div><img src="blob:page-1"><img src="data:image/png;base64,AA=="><img src="blob:done"></div>');
    const [loading, inline, done] = Array.from(host.querySelectorAll("img"));
    [loading, inline].forEach((image) => Object.defineProperty(image, "complete", { value: false }));
    Object.defineProperty(done, "complete", { value: true });
    expect(loadingImages(host)).toEqual([loading]);
    host.remove();
  });

  it("finds nothing to wait for when an annotation has no images", () => {
    const host = fromMarkup("<div><span>Not</span></div>");
    expect(loadingImages(host)).toEqual([]);
    host.remove();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cssColor, markerTransform, normalizeMermaidSvg } from "./mermaidSvg";

type Stubbed = Record<string, unknown>;

const STUBS = ["getNumberOfChars", "getStartPositionOfChar", "getTotalLength", "getPointAtLength"] as const;

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

beforeEach(() => {
  const proto = SVGElement.prototype as unknown as Stubbed;
  proto.getNumberOfChars = function (this: Element) {
    return (this.textContent ?? "").replace(/\s+/g, " ").length;
  };
  proto.getStartPositionOfChar = function (this: Element) {
    return { x: Number(this.getAttribute("data-start-x") ?? 0), y: Number(this.getAttribute("data-start-y") ?? 0) };
  };
  proto.getTotalLength = () => 10;
  proto.getPointAtLength = (distance: number) => ({ x: distance, y: 0 });
});

afterEach(() => {
  const proto = SVGElement.prototype as unknown as Stubbed;
  for (const name of STUBS) delete proto[name];
  document.body.innerHTML = "";
});

describe("css colours", () => {
  it("turns computed colours into hex with their alpha kept apart", () => {
    expect(cssColor("rgb(255, 0, 16)")).toEqual({ color: "#ff0010", alpha: 1 });
    expect(cssColor("rgba(0, 0, 0, 0.5)")).toEqual({ color: "#000000", alpha: 0.5 });
    expect(cssColor("rgb(10 20 30 / 25%)")).toEqual({ color: "#0a141e", alpha: 0.25 });
    expect(cssColor('url("#grad")')).toEqual({ color: "url(#grad)", alpha: 1 });
  });

  it("treats transparent paint as none and leaves unknown values alone", () => {
    expect(cssColor("transparent")).toEqual({ color: "none", alpha: 1 });
    expect(cssColor("rgba(1, 2, 3, 0)")).toEqual({ color: "none", alpha: 1 });
    expect(cssColor("")).toBeNull();
    expect(cssColor("currentcolor")).toBeNull();
  });
});

describe("marker transform", () => {
  const spec = { refX: 5, refY: 5, viewBox: { x: 0, y: 0, width: 10, height: 10 }, markerWidth: 8, markerHeight: 8, strokeUnits: false, orient: "auto" };

  it("points the marker along the path and scales its view box to its size", () => {
    expect(markerTransform(spec, { x: 100, y: 50 }, 90, "end", 2)).toBe("translate(100 50) rotate(90) scale(0.8) translate(-5 -5)");
  });

  it("scales by the stroke width and turns a start marker round when asked", () => {
    expect(markerTransform({ ...spec, strokeUnits: true, orient: "auto-start-reverse" }, { x: 0, y: 0 }, 0, "start", 2)).toBe("translate(0 0) rotate(180) scale(1.6) translate(-5 -5)");
    expect(markerTransform({ ...spec, viewBox: null, orient: "45" }, { x: 0, y: 0 }, 0, "end", 1)).toBe("translate(0 0) rotate(45) scale(1) translate(-5 -5)");
  });
});

describe("normalizing mermaid output", () => {
  it("inlines the styles, draws markers as shapes and pins text to its start", () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" id="m1" viewBox="-4 -4 200 100" style="max-width: 200px" width="100%">' +
      '<style>#m1 .edge{stroke:rgb(51, 51, 51);stroke-width:2px;fill:none}</style>' +
      '<defs><marker id="m1_end" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" style="fill: rgb(1, 2, 3)"/></marker></defs>' +
      '<path class="edge" d="M0,0 L10,0" marker-end="url(#m1_end)"/>' +
      '<g transform="translate(20, 30)"><text text-anchor="middle" style="fill: rgb(0, 0, 0); font-size: 16px; font-family: &quot;trebuchet ms&quot;, arial" onclick="alert(1)"><tspan data-start-x="-12" data-start-y="5">Şişli</tspan><tspan data-start-x="8" data-start-y="5"> Ağaç</tspan></text></g>' +
      '<script>alert(1)</script></svg>';

    const art = normalizeMermaidSvg(markup);

    expect(art).not.toBeNull();
    expect(art?.width).toBe(200);
    expect(art?.height).toBe(100);
    const out = parse(art?.svg ?? "");
    const root = out.documentElement;
    expect(root.getAttribute("width")).toBe("200");
    expect(root.getAttribute("style")).toBeNull();
    expect(out.querySelector("style, marker, script, [onclick]")).toBeNull();
    const edge = out.querySelector('path[d="M0,0 L10,0"]');
    expect(edge?.getAttribute("marker-end")).toBeNull();
    const arrow = edge?.nextElementSibling;
    expect(arrow?.getAttribute("transform")).toBe("translate(10 0) rotate(0) scale(0.8) translate(-5 -5)");
    expect(arrow?.querySelector("path")?.getAttribute("fill")).toBe("#010203");
    const labels = Array.from(out.querySelectorAll("text"));
    expect(labels.map((label) => [label.textContent, label.getAttribute("x"), label.getAttribute("y")])).toEqual([
      ["Şişli", "-12", "5"],
      ["Ağaç", "8", "5"],
    ]);
    expect(labels[0].getAttribute("text-anchor")).toBeNull();
    expect(labels[0].getAttribute("font-size")).toBe("16");
    expect(labels[0].getAttribute("font-family")).toBe("trebuchet ms, arial");
    expect(document.body.children).toHaveLength(0);
  });

  it("turns an HTML label into centred SVG text lines", () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><foreignObject x="10" y="10" width="80" height="40">' +
      '<div xmlns="http://www.w3.org/1999/xhtml"><span>Fikir<br/>bir</span></div></foreignObject></svg>';

    const art = normalizeMermaidSvg(markup);

    const out = parse(art?.svg ?? "");
    expect(out.querySelector("foreignObject")).toBeNull();
    expect(Array.from(out.querySelectorAll("text")).map((label) => label.textContent)).toEqual(["Fikir", "bir"]);
  });

  it("returns nothing for markup that is not a drawing", () => {
    expect(normalizeMermaidSvg("<html><body>no</body></html>")).toBeNull();
    expect(normalizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull();
    expect(normalizeMermaidSvg("<svg")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { STUDIO_DESIGN_VERSION } from "@/types/studio";
import { createDesign, createQr, createShape, createText, hasPlaceholders, normalizeDesign, normalizeElement, placeholdersIn, STUDIO_PAGE_SIZES } from "./design";

describe("studio design model", () => {
  it("creates a one-page design with a white background", () => {
    const design = createDesign("Poster", STUDIO_PAGE_SIZES.a4.width, STUDIO_PAGE_SIZES.a4.height);

    expect(design.version).toBe(STUDIO_DESIGN_VERSION);
    expect(design.pages).toHaveLength(1);
    expect(design.pages[0].background.fill).toEqual({ type: "solid", color: "#ffffff" });
  });

  it("clamps impossible page sizes", () => {
    const design = createDesign("Tiny", 1, 99999);

    expect(design.pages[0].width).toBe(18);
    expect(design.pages[0].height).toBe(14400);
  });

  it("lists data columns used in text and QR values without the built-ins", () => {
    const design = createDesign("Certificate", 800, 600);
    design.pages[0].elements.push(createText(0, 0, 100, 20, "Dear {Name}, no. {n} on {date}"), createQr("https://x.test/{Id}?n={Name}", 0, 0, 50));

    expect(placeholdersIn(design)).toEqual(["Name", "Id"]);
    expect(hasPlaceholders("plain {{escaped}} text")).toBe(false);
    expect(hasPlaceholders("{Name}")).toBe(true);
  });

  it("round-trips a design through JSON", () => {
    const design = createDesign("Card", 252, 144);
    design.pages[0].elements.push(createText(10, 10, 100, 30, "Hello", { bold: true }), createShape("star", 5, 5, 40, 40));

    expect(normalizeDesign(JSON.parse(JSON.stringify(design)))).toEqual(design);
  });

  it("repairs bad values and drops unknown or unusable elements", () => {
    const raw = {
      version: 1,
      kind: "design",
      name: "Broken",
      palette: ["#ff0000", "red"],
      pages: [
        {
          id: "p1",
          width: "wide",
          height: 500,
          elements: [
            { kind: "text", id: "same", x: Number.NaN, width: -5, runs: [{ text: "Hi", color: "blue" }], fontSize: 5000 },
            { kind: "shape", id: "same", shape: "blob", fill: { type: "linear", angle: 45, stops: [] } },
            { kind: "image" },
            { kind: "mystery" },
          ],
        },
      ],
    };

    const design = normalizeDesign(raw);

    expect(design?.palette).toEqual(["#ff0000"]);
    const page = design?.pages[0];
    expect(page?.width).toBeCloseTo(595.28);
    expect(page?.elements).toHaveLength(2);
    const [text, shape] = page?.elements ?? [];
    expect(text.kind === "text" && text.fontSize).toBe(1000);
    expect(text.x).toBe(0);
    expect(text.width).toBe(1);
    expect(text.kind === "text" && text.runs[0].color).toBeUndefined();
    expect(shape.id).not.toBe("same");
    expect(shape.kind === "shape" && shape.shape).toBe("rect");
    expect(shape.kind === "shape" && shape.fill.type === "linear" && shape.fill.stops).toHaveLength(2);
  });

  it("refuses files that are not designs or come from a newer version", () => {
    expect(normalizeDesign(null)).toBeNull();
    expect(normalizeDesign({ kind: "document", version: 1, pages: [{}] })).toBeNull();
    expect(normalizeDesign({ kind: "design", version: STUDIO_DESIGN_VERSION + 1, pages: [{}] })).toBeNull();
    expect(normalizeDesign({ kind: "design", version: 1, pages: [] })).toBeNull();
    expect(normalizeElement({ kind: "vector", paths: [{ d: "" }] })).toBeNull();
  });
});

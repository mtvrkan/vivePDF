import { describe, expect, it } from "vitest";
import { STUDIO_DESIGN_VERSION } from "@/types/studio";
import { MAX_PAGE_NAME, createDesign, createQr, createShape, createText, hasPlaceholders, libraryFontIds, normalizeDesign, normalizeElement, placeholdersIn, STUDIO_PAGE_SIZES, textDirection } from "./design";

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

  it("gives old pages an empty name and trims or clips stored names", () => {
    const design = createDesign("Deck", 100, 100);
    const oldPage: Record<string, unknown> = { ...design.pages[0] };
    delete oldPage.name;
    const raw = { ...design, pages: [oldPage, { ...design.pages[0], id: "b", name: "  Cover  " }, { ...design.pages[0], id: "c", name: "x".repeat(500) }, { ...design.pages[0], id: "d", name: 7 }] };

    const pages = normalizeDesign(raw)?.pages ?? [];

    expect(pages.map((page) => page.name.length)).toEqual([0, 5, MAX_PAGE_NAME, 0]);
    expect(pages[1].name).toBe("Cover");
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

  it("lists the downloadable library fonts a design uses, once and in order", () => {
    const design = createDesign("Fonts", 200, 100);
    const page = {
      ...design.pages[0],
      elements: [
        createText(0, 0, 10, 10, "a", { fontId: "library:lora" }),
        createText(0, 0, 10, 10, "b", { fontId: "system:Arial" }),
        createText(0, 0, 10, 10, "c", { fontId: "library:inter" }),
        createText(0, 0, 10, 10, "d", { fontId: "library:lora" }),
        createShape("rect", 0, 0, 10, 10),
      ],
    };

    expect(libraryFontIds({ ...design, pages: [page] })).toEqual(["library:inter", "library:lora"]);
    expect(libraryFontIds(null)).toEqual([]);
  });
});

describe("studio text direction", () => {
  const arabic = String.fromCodePoint(0x633, 0x627, 0x631, 0x629);

  it("reads right to left when the first letter is Arabic, even after digits", () => {
    expect(textDirection(`2027 ${arabic} Studio`)).toBe("rtl");
  });

  it("reads left to right when a Latin letter comes first", () => {
    expect(textDirection(`Studio ${arabic}`)).toBe("ltr");
  });

  it("falls back to left to right without any letter", () => {
    expect(textDirection("2027 · 12")).toBe("ltr");
  });
});

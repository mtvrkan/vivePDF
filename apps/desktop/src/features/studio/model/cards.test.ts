import { describe, expect, it } from "vitest";
import { createDesign, normalizeDesign, STUDIO_PAGE_SIZES } from "./design";
import { CARD_SIZES, cornerOf, createCardDesign, isCardPage, withCorner } from "./cards";

describe("business card designs", () => {
  it("creates a front and a back page at the chosen card size", () => {
    const design = createCardDesign("businessCardEu", { front: "Front", back: "Back" });

    expect(design.pages.map((page) => page.name)).toEqual(["Front", "Back"]);
    expect(design.pages.every((page) => page.width === STUDIO_PAGE_SIZES.businessCardEu.width && page.height === STUDIO_PAGE_SIZES.businessCardEu.height)).toBe(true);
    expect(new Set(design.pages.map((page) => page.id)).size).toBe(2);
  });

  it("recognises every card size in either orientation and nothing else", () => {
    const sizes = CARD_SIZES.map((size) => STUDIO_PAGE_SIZES[size]);

    expect(sizes.every((size) => isCardPage(size) && isCardPage({ width: size.height, height: size.width }))).toBe(true);
    expect(isCardPage(STUDIO_PAGE_SIZES.a4)).toBe(false);
  });

  it("clamps the corner radius, drops it at zero and keeps it through a save", () => {
    const design = createDesign("", 240, 155);

    const rounded = withCorner(design, 25);
    const square = withCorner(rounded, 0);

    expect(cornerOf(rounded)).toBe(10);
    expect(normalizeDesign(JSON.parse(JSON.stringify(rounded)))?.print).toEqual({ cornerMm: 10 });
    expect(square).not.toHaveProperty("print");
    expect(withCorner(design, Number.NaN)).toBe(design);
  });

  it("ignores a broken print block when a design is opened", () => {
    const raw = JSON.parse(JSON.stringify(createDesign("", 240, 155)));
    raw.print = { cornerMm: "round" };

    expect(normalizeDesign(raw)).not.toHaveProperty("print");
  });
});

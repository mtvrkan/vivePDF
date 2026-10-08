import { describe, expect, it } from "vitest";
import { normalizeDesign } from "../model/design";
import { averageColor, blend, contrastRatio, readableOn } from "./contrast";
import { box, design, foil, gradient, pageOf, radial, shadowed, solid, text, typeScale } from "./kit";
import { PALETTES, paletteList } from "./palettes";

describe("premium kit", () => {
  it("spreads gradient stops evenly and builds foils from five stops", () => {
    expect(gradient(90, ["#000000", "#808080", "#ffffff"]).type).toBe("linear");
    expect((gradient(90, ["#000000", "#808080", "#ffffff"]) as { stops: { offset: number }[] }).stops.map((stop) => stop.offset)).toEqual([0, 0.5, 1]);
    expect((foil("gold") as { stops: unknown[] }).stops).toHaveLength(5);
  });

  it("keeps radial fills, shadows and text shadows through normalisation", () => {
    const page = pageOf("a4", radial("#ffffff", "#eeeeee", { cy: 0.3, middle: "#f6f6f6" }), [
      shadowed(box("rect", 40, 40, 200, 120, solid("#ffffff"), { radius: 12 }), "lifted"),
      text(40, 200, 300, 60, "Title", { size: 32, shadow: "subtle" }),
    ]);
    const built = design("Kit", ["#111111"], [page]);

    expect(normalizeDesign(JSON.parse(JSON.stringify(built)))).toEqual(built);
    expect(built.pages[0].elements[0]).toMatchObject({ dropShadow: { blur: 26 } });
    expect(built.pages[0].elements[1]).toMatchObject({ shadow: { y: 1 } });
  });

  it("builds a type scale in half points from the body size", () => {
    const scale = typeScale(10);

    expect(scale.body).toBe(10);
    expect(scale.title).toBe(18);
    expect(scale.display).toBe(23.5);
    expect(scale.caption).toBeLessThan(scale.body);
  });

  it("gives every palette readable ink on its paper", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(contrastRatio(palette.ink, palette.paper), name).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.muted, palette.paper), name).toBeGreaterThanOrEqual(4.5);
      expect(new Set(paletteList(palette)).size, name).toBe(paletteList(palette).length);
    }
  });
});

describe("contrast helpers", () => {
  it("measures black on white at 21 and identical colours at 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#336699", "#336699")).toBe(1);
  });

  it("averages gradient stops and blends a see-through colour over another", () => {
    expect(averageColor(gradient(0, ["#000000", "#ffffff"]))).toBe("#808080");
    expect(averageColor({ type: "none" })).toBeNull();
    expect(blend("#ffffff", "#000000", 0.5)).toBe("#808080");
  });

  it("picks the readable text colour and ignores colours it cannot read", () => {
    expect(readableOn("#0f172a")).toBe("#ffffff");
    expect(readableOn("#fef3c7")).toBe("#111827");
    expect(averageColor(solid("rgba(0,0,0,0.5)"))).toBeNull();
  });
  it("grows a text box to hold its lines and keeps the text where it was drawn", () => {
    const top = text(0, 100, 200, 20, "One\nTwo", { size: 20, lineHeight: 1 });
    const middle = text(0, 100, 200, 20, "Big", { size: 40, lineHeight: 1, valign: "middle" });
    const bottom = text(0, 100, 200, 20, "Big", { size: 40, lineHeight: 1, valign: "bottom" });
    const turned = text(0, 100, 200, 20, "Big", { size: 40, lineHeight: 1, rotation: 10 });

    expect([top.y, top.height]).toEqual([100, 40]);
    expect([middle.y + middle.height / 2, middle.height]).toEqual([110, 40]);
    expect(bottom.y + bottom.height).toBe(120);
    expect([turned.y, turned.height]).toEqual([100, 20]);
  });
});

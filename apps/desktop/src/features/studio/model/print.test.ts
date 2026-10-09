import { describe, expect, it } from "vitest";
import { createDesign, createImage, createShape, createText } from "./design";
import { bleedElement, bleedPage, millimetresToPoints, shiftFill } from "./print";
import { pageToRender } from "./render";

const page = { width: 240, height: 150 };

describe("print bleed", () => {
  it("runs rectangles and pictures that touch the trim edge into the bleed", () => {
    const band = createShape("rect", 0, 100, 240, 50);
    const photo = createImage("C:/a.png", 120, 0, 120.2, 80);

    expect(bleedElement(band, page, 8.5)).toMatchObject({ x: -8.5, y: 100, width: 257, height: 58.5 });
    expect(bleedElement(photo, page, 8.5)).toMatchObject({ x: 120, y: -8.5, width: 128.5, height: 88.5 });
  });

  it("leaves inner, turned, round and text elements where they are", () => {
    const inner = createShape("rect", 10, 10, 50, 50);
    const turned = { ...createShape("rect", 0, 0, 50, 50), rotation: 15 };
    const round = createShape("ellipse", 0, 0, 50, 50);
    const text = createText(0, 0, 100, 30, "Edge");

    for (const element of [inner, turned, round, text]) expect(bleedElement(element, page, 8.5)).toBe(element);
    expect(bleedElement(createShape("rect", 0, 0, 10, 10), page, 0)).toMatchObject({ x: 0, y: 0 });
  });

  it("keeps the trim size and widens the background into the bleed without moving its gradient", () => {
    const design = createDesign("Card", 240, 150);
    const card = { ...design.pages[0], background: { fill: { type: "linear" as const, angle: 90, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] }, image: null } };
    const plain = pageToRender(card);
    const bled = pageToRender(card, new Map(), { bleed: 8.5 });

    expect(bled).toMatchObject({ width: 240, height: 150 });
    expect(bled.items[0]).toMatchObject({ x: -8.5, y: -8.5, width: 257, height: 167 });
    const before = plain.items[0].kind === "vector" ? plain.items[0].paths[0].fill : null;
    const after = bled.items[0].kind === "vector" ? bled.items[0].paths[0].fill : null;
    expect(after).toEqual(before ? shiftFill(before, 8.5, 8.5) : null);
    expect(bleedPage(card, 0)).toBe(card);
    expect(millimetresToPoints(3)).toBeCloseTo(8.504, 3);
  });
});

import { describe, expect, it } from "vitest";
import { createImage, createPage, createShape, createText, normalizeElement } from "./design";
import { addElements, elementBounds, unionBounds } from "./edit";
import { flipElements, flipTransform, withFlip } from "./flip";
import { elementItems } from "./render";

function pageWith(...elements: Parameters<typeof addElements>[1]) {
  return addElements(createPage(400, 400), elements);
}

describe("flip", () => {
  it("toggles a single element in its own frame and keeps its place and rotation", () => {
    const shape = { ...createShape("triangle", 10, 20, 100, 50), rotation: 30 };
    const page = pageWith(shape);

    const once = flipElements(page, [shape.id], "horizontal");
    const twice = flipElements(once, [shape.id], "horizontal");

    expect(once.elements[0]).toMatchObject({ x: 10, y: 20, rotation: 30, flipX: true });
    expect(twice.elements[0]).toEqual(shape);
    expect("flipX" in twice.elements[0]).toBe(false);
  });

  it("mirrors a multi-selection across its centre, negating rotation and toggling each flip", () => {
    const left = { ...createShape("rect", 0, 0, 20, 20), rotation: 15 };
    const right = createText(80, 0, 20, 20, "A");
    const page = pageWith(left, right);

    const next = flipElements(page, [left.id, right.id], "horizontal");

    const box = unionBounds([left, right].map(elementBounds));
    const centre = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const [movedLeft, movedRight] = next.elements;
    expect(movedLeft.x + 10).toBeCloseTo(2 * centre - 10);
    expect(movedRight.x + 10).toBeCloseTo(2 * centre - 90);
    expect(movedLeft).toMatchObject({ y: 0, rotation: -15, flipX: true });
    expect(movedRight).toMatchObject({ rotation: 0, flipX: true });
    expect(unionBounds(next.elements.map(elementBounds))).toEqual(expect.objectContaining({ width: expect.closeTo(box?.width ?? 0) }));
  });

  it("leaves locked elements and unknown ids untouched", () => {
    const locked = { ...createShape("rect", 0, 0, 20, 20), locked: true };
    const page = pageWith(locked);

    expect(flipElements(page, [locked.id], "vertical")).toBe(page);
    expect(flipElements(page, ["missing"], "vertical")).toBe(page);
  });

  it("writes CSS that flips inside the rotated frame", () => {
    expect(flipTransform({ rotation: 0 })).toBeUndefined();
    expect(flipTransform({ rotation: 45, flipX: true })).toBe("rotate(45deg) scale(-1, 1)");
    expect(flipTransform({ rotation: 0, flipY: true })).toBe("scale(1, -1)");
  });

  it("keeps flips through normalisation and drops anything but true", () => {
    const image = withFlip(createImage("a.png", 0, 0, 10, 10), "vertical", true);

    expect(normalizeElement(image)).toMatchObject({ flipY: true });
    expect(normalizeElement({ ...image, flipY: "yes" })).not.toHaveProperty("flipY");
    expect(normalizeElement(createImage("a.png", 0, 0, 10, 10))).not.toHaveProperty("flipX");
  });

  it("sends flips to the renderer for every kind", () => {
    const text = withFlip(createText(0, 0, 50, 20, "Hi"), "horizontal", true);
    const shape = withFlip(createShape("star", 0, 0, 50, 50), "vertical", true);

    expect(elementItems(text)[0]).toMatchObject({ flipX: true });
    expect(elementItems(shape)[0]).toMatchObject({ flipY: true });
    expect(elementItems(createShape("rect", 0, 0, 5, 5))[0]).not.toHaveProperty("flipX");
  });
});

import { describe, expect, it } from "vitest";
import { createShape, createText } from "../model/design";
import { normalizeAngle, resizeBox, rotationFromPointer, scaleElements, snapBounds, snapTargets } from "./transform";

const box = { x: 100, y: 100, width: 100, height: 50, rotation: 0 };

describe("studio transforms", () => {
  it("resizes from a corner keeping the opposite corner fixed", () => {
    expect(resizeBox(box, "se", 20, 10)).toEqual({ ...box, width: 120, height: 60 });
    expect(resizeBox(box, "nw", -20, -10)).toEqual({ ...box, x: 80, y: 90, width: 120, height: 60 });
  });

  it("keeps the ratio when asked and never collapses", () => {
    const wide = resizeBox(box, "e", 100, 0, { keepRatio: true });
    expect(wide.width).toBe(200);
    expect(wide.height).toBe(100);
    expect(resizeBox(box, "w", 500, 0).width).toBe(2);
  });

  it("resizes from the centre", () => {
    expect(resizeBox(box, "e", 10, 0, { fromCenter: true })).toEqual({ ...box, x: 90, width: 120 });
  });

  it("grows a turned box along its own axis and keeps its anchor in place", () => {
    const turned = { ...box, rotation: 90 };

    const grown = resizeBox(turned, "e", 0, 30);

    expect(grown.width).toBeCloseTo(130);
    expect(grown.height).toBeCloseTo(50);
    const anchorBefore = { x: 150, y: 125 - 50 };
    const centreAfter = { x: grown.x + grown.width / 2, y: grown.y + grown.height / 2 };
    expect(centreAfter.x).toBeCloseTo(anchorBefore.x);
    expect(centreAfter.y - grown.width / 2).toBeCloseTo(anchorBefore.y);
  });

  it("turns with the pointer, sticks near 45° steps and steps by 15° with Shift", () => {
    const centre = { x: 0, y: 0 };

    expect(rotationFromPointer(centre, { x: 0, y: -10 })).toBe(0);
    expect(rotationFromPointer(centre, { x: 10, y: 0 })).toBe(90);
    expect(rotationFromPointer(centre, { x: 10, y: -0.3 })).toBe(90);
    expect(rotationFromPointer(centre, { x: 10, y: -3 }, { step: true })).toBe(75);
    expect(normalizeAngle(270)).toBe(-90);
  });

  it("scales a selection and its text sizes together", () => {
    const shape = createShape("rect", 0, 0, 50, 50);
    const text = createText(50, 50, 50, 50, "Hi", { fontSize: 10 });

    const [bigShape, bigText] = scaleElements([shape, text], { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 200, height: 200 });

    expect(bigShape).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(bigText).toMatchObject({ x: 100, y: 100, fontSize: 20 });
    const [stretched] = scaleElements([text], { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 200, height: 100 });
    expect(stretched.kind === "text" && stretched.fontSize).toBe(10);
  });

  it("snaps edges and centres to the page and other elements", () => {
    const targets = snapTargets(500, 400, [{ x: 300, y: 20, width: 50, height: 50 }]);

    const snapped = snapBounds({ x: 203, y: 172, width: 100, height: 50 }, targets, 4);

    expect(snapped.dx).toBe(-3);
    expect(snapped.dy).toBe(3);
    expect(snapped.guides.map((guide) => guide.axis)).toEqual(["x", "y"]);
    expect(snapBounds({ x: 120, y: 120, width: 10, height: 10 }, targets, 4)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

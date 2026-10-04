import { describe, expect, it } from "vitest";
import { createShape, createText } from "../model/design";
import { normalizeAngle, resizeBox, rotateElements, rotationFromPointer, scaleBoundsByHandle, scaleElements, turnFromPointer } from "./transform";

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

  it("turns a selection as a whole around its centre", () => {
    const left = createShape("rect", 0, 0, 20, 10);
    const right = createShape("rect", 80, 0, 20, 10, { rotation: 10 });

    const [a, b] = rotateElements([left, right], { x: 50, y: 5 }, 90);

    expect(a.x + a.width / 2).toBeCloseTo(50);
    expect(a.y + a.height / 2).toBeCloseTo(-35);
    expect(a.rotation).toBe(90);
    expect(b.x + b.width / 2).toBeCloseTo(50);
    expect(b.y + b.height / 2).toBeCloseTo(45);
    expect(b.rotation).toBe(100);
    expect(rotateElements([left], { x: 0, y: 0 }, 0)[0]).toBe(left);
  });

  it("measures the turn from where the drag started, with 15° steps and a 45° magnet", () => {
    const centre = { x: 0, y: 0 };
    const origin = { x: 10, y: 0 };

    expect(turnFromPointer(centre, origin, { x: 0, y: 10 })).toBe(90);
    expect(turnFromPointer(centre, origin, { x: 10, y: 1.5 })).toBeCloseTo(8.5);
    expect(turnFromPointer(centre, origin, { x: 10, y: 0.3 })).toBe(0);
    expect(turnFromPointer(centre, origin, { x: 10, y: 3.5 }, { step: true })).toBe(15);
    expect(turnFromPointer(centre, origin, { x: -10, y: -0.1 })).toBe(180);
  });

  it("scales a selection box from its centre with Alt", () => {
    const start = { x: 0, y: 0, width: 100, height: 50 };

    expect(scaleBoundsByHandle(start, "se", 10, 0, false, true)).toEqual({ x: -10, y: 0, width: 120, height: 50 });
    expect(scaleBoundsByHandle(start, "se", 10, 0, false)).toEqual({ x: 0, y: 0, width: 110, height: 50 });
  });
});

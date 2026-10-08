import { describe, expect, it } from "vitest";
import type { StudioFill, StudioStroke } from "@/types/studio";
import { createDesign, createImage, createQr, createShape, createText } from "../model/design";
import { cornersOf, isCornerable, isFillable, isLineElement, isRoundable, isShadowable, isStrokable, maxCornerRadius, mergeEdit, moveSelectionTo, resizeSelectionTo, selectionFrame, shadowDifferences, sharedValue, sizeElementTo, withCorner } from "./multiEdit";

const stroke = (color: string, width: number): StudioStroke => ({ color, width, dash: "solid" });

describe("editing several elements at once", () => {
  it("tells shared values from mixed ones, whatever the key order", () => {
    expect(sharedValue([0.5, 0.5])).toEqual({ value: 0.5, mixed: false });
    expect(sharedValue([{ color: "#000000", width: 1 }, { width: 1, color: "#000000" }]).mixed).toBe(false);
    expect(sharedValue([stroke("#000000", 1), stroke("#000000", 2)])).toEqual({ value: stroke("#000000", 1), mixed: true });
    expect(sharedValue([null, stroke("#000000", 1)]).mixed).toBe(true);
  });

  it("changes only the edited part of each element's stroke or fill", () => {
    const before = stroke("#111111", 1);
    const after = { ...before, width: 4 };

    expect(mergeEdit<StudioStroke | null>(stroke("#ff0000", 2), before, after)).toEqual(stroke("#ff0000", 4));
    expect(mergeEdit<StudioStroke | null>(null, before, after)).toBeNull();
    expect(mergeEdit<StudioStroke | null>(null, null, after)).toEqual(after);
    expect(mergeEdit<StudioStroke | null>(stroke("#ff0000", 2), before, null)).toBeNull();
    expect(mergeEdit<StudioStroke | null>({ ...stroke("#ff0000", 2), cap: "round" }, { ...before, cap: "round" }, before)).toEqual(stroke("#ff0000", 2));
  });

  it("gives every element the new fill when the fill type changes", () => {
    const solid: StudioFill = { type: "solid", color: "#111111" };
    const linear: StudioFill = { type: "linear", angle: 90, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] };

    expect(mergeEdit<StudioFill>({ type: "solid", color: "#ff0000" }, solid, { type: "solid", color: "#00ff00" })).toEqual({ type: "solid", color: "#00ff00" });
    expect(mergeEdit<StudioFill>({ type: "solid", color: "#ff0000" }, solid, linear)).toEqual(linear);
    expect(mergeEdit<StudioFill>(linear, solid, { type: "solid", color: "#00ff00" })).toEqual({ type: "solid", color: "#00ff00" });
  });

  it("knows which elements share fill, stroke and corner controls", () => {
    const rect = createShape("rect", 0, 0, 40, 20);
    const line = createShape("line", 0, 0, 40, 20);
    const photo = { ...createImage("a.png", 0, 0, 100, 100), mask: "rounded" as const };
    const text = createText(0, 0, 10, 10, "Hi");

    expect([rect, line, photo, text].map(isFillable)).toEqual([true, false, false, false]);
    expect([rect, line, photo, text].map(isStrokable)).toEqual([true, true, true, false]);
    expect([rect, line, photo, text].map(isRoundable)).toEqual([true, false, true, false]);
    expect(maxCornerRadius([rect, photo])).toBe(10);
  });

  it("moves and resizes the selection as one box", () => {
    const design = createDesign("Group", 400, 400);
    const left = createShape("rect", 10, 10, 20, 20);
    const right = createShape("rect", 50, 30, 30, 20);
    const other = createShape("rect", 300, 300, 10, 10);
    const page = { ...design.pages[0], elements: [left, right, other] };
    const ids = [left.id, right.id];

    const moved = moveSelectionTo(page, ids, 100, 200);
    expect(selectionFrame(moved.elements.slice(0, 2))).toEqual({ x: 100, y: 200, width: 70, height: 40 });
    expect(moved.elements[2]).toBe(other);

    const resized = resizeSelectionTo(page, ids, 140, 40);
    expect(selectionFrame(resized.elements.slice(0, 2))).toEqual({ x: 10, y: 10, width: 140, height: 40 });
    expect(resized.elements[0]).toMatchObject({ x: 10, width: 40, height: 20 });
    expect(resizeSelectionTo(page, [], 10, 10)).toBe(page);
  });
});

describe("editing shadows, corners and line ends together", () => {
  const shadow = { color: "#000000", opacity: 0.4, x: 3, y: 5, blur: 8 };

  it("reports which shadow values differ and when only some items have one", () => {
    expect(shadowDifferences([shadow, { ...shadow, blur: 2 }])).toEqual(new Set(["blur"]));
    expect(shadowDifferences([shadow, null])).toEqual(new Set(["presence"]));
    expect(shadowDifferences([null, null]).size).toBe(0);
  });

  it("changes one corner from the linked radius", () => {
    const rect = { ...createShape("rect", 0, 0, 100, 100), cornerRadius: 12 };

    expect(cornersOf(rect)).toEqual([12, 12, 12, 12]);
    expect(withCorner(rect, 2, 30)).toEqual([12, 12, 30, 12]);
    expect(withCorner({ ...rect, corners: [1, 2, 3, 4] }, 0, 9)).toEqual([9, 2, 3, 4]);
  });

  it("knows which elements take corners, line ends and shadows", () => {
    expect(isCornerable(createShape("rect", 0, 0, 1, 1))).toBe(true);
    expect(isCornerable(createShape("speech", 0, 0, 1, 1))).toBe(false);
    expect(isLineElement(createShape("arrowLine", 0, 0, 1, 1))).toBe(true);
    expect(isShadowable(createImage("a.png", 0, 0, 1, 1))).toBe(true);
    expect(isShadowable(createText(0, 0, 1, 1, "a"))).toBe(false);
  });

  it("sizes one element from a field, following its ratio lock", () => {
    const picture = createImage("a.png", 10, 10, 40, 20);
    const box = createShape("rect", 10, 10, 40, 20);

    expect(sizeElementTo(picture, { width: 80 })).toEqual({ width: 80, height: 40 });
    expect(sizeElementTo(box, { width: 80 })).toEqual({ width: 80, height: 20 });
    expect(sizeElementTo({ ...box, lockRatio: true }, { height: 40 })).toEqual({ width: 80, height: 40 });
    expect(sizeElementTo(createQr("x", 0, 0, 30), { width: 50 })).toEqual({ width: 50, height: 50 });
  });

  it("keeps a turned element's centre and never shrinks below the smallest side", () => {
    const turned = { ...createShape("rect", 0, 0, 40, 20), rotation: 45 };

    const sized = sizeElementTo(turned, { width: 80 });
    const tiny = sizeElementTo(createShape("rect", 0, 0, 40, 20), { width: 0 });

    expect(sized).toEqual({ x: -20, y: 0, width: 80, height: 20 });
    expect(tiny.width).toBe(2);
  });
});

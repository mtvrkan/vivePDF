import { describe, expect, it } from "vitest";
import { defaultSettings, POINTS_PER_MM, uniformMargins } from "./model";
import { draggedIndents, draggedMargin, indentsOf, indentsPatch, MIN_LINE_PT, rulerTicks } from "./ruler";

const WIDTH = 450;
const A4 = { width: 595, height: 842 };

describe("document ruler", () => {
  it("moves the first line alone, the rest with the hanging marker, and both with the left box", () => {
    const start = { left: 36, right: 0, firstLine: -18 };

    expect(draggedIndents("firstLine", start, 0, WIDTH)).toEqual({ left: 36, right: 0, firstLine: -36 });
    expect(draggedIndents("hanging", start, 54, WIDTH)).toEqual({ left: 54, right: 0, firstLine: -36 });
    expect(draggedIndents("left", start, 72, WIDTH)).toEqual({ left: 72, right: 0, firstLine: -18 });
    expect(draggedIndents("right", start, WIDTH - 40, WIDTH)).toEqual({ left: 36, right: 40, firstLine: -18 });
  });

  it("keeps the first line on the page and every line at least a short measure wide", () => {
    const hanging = { left: 20, right: 0, firstLine: -20 };

    expect(draggedIndents("left", hanging, 0, WIDTH).left).toBe(20);
    expect(draggedIndents("firstLine", hanging, -50, WIDTH).firstLine).toBe(-20);
    expect(draggedIndents("right", { left: 100, right: 0, firstLine: 0 }, 0, WIDTH).right).toBe(WIDTH - 100 - MIN_LINE_PT);
    expect(draggedIndents("hanging", hanging, 9999, WIDTH).left).toBe(WIDTH - MIN_LINE_PT);
  });

  it("reads missing or broken indents as zero and writes zeros back as no indent", () => {
    expect(indentsOf({ indentLeft: "wide", firstLineIndent: -9999 })).toEqual({ left: 0, right: 0, firstLine: -288 });
    expect(indentsPatch({ left: 0, right: 12.345, firstLine: -0.001 })).toEqual({ indentLeft: null, indentRight: 12.35, firstLineIndent: null });
  });

  it("drags each margin to the nearest millimetre, past the gutter and inside the limits", () => {
    const settings = { ...defaultSettings(), ...uniformMargins(20), gutterMm: 10, gutterSide: "left" as const };

    expect(draggedMargin("left", settings, 45.2 * POINTS_PER_MM, A4)).toEqual({ marginLeftMm: 35 });
    expect(draggedMargin("right", settings, A4.width - 24.6 * POINTS_PER_MM, A4)).toEqual({ marginRightMm: 25 });
    expect(draggedMargin("top", settings, 0, A4)).toEqual({ marginTopMm: 5 });
    expect(draggedMargin("bottom", settings, 0, A4)).toEqual({ marginBottomMm: 60 });
  });

  it("numbers whole centimetres outward from the margin and leaves the margin itself unlabelled", () => {
    const ticks = rulerTicks(100 * POINTS_PER_MM, 20 * POINTS_PER_MM);
    const labels = ticks.filter((tick) => tick.label !== null).map((tick) => tick.label);

    expect(labels).toEqual([2, 1, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ticks.find((tick) => Math.abs(tick.at - 20 * POINTS_PER_MM) < 0.01)).toMatchObject({ kind: "major", label: null });
    expect(ticks.every((tick) => tick.at >= 0 && tick.at <= 100 * POINTS_PER_MM + 0.01)).toBe(true);
  });
});

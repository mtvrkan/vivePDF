import { describe, expect, it } from "vitest";
import { drawingExtent, hitsDrawing, scaleDrawing } from "@/shared/lib/drawingGeometry";
import { canRotate } from "./drawingRotate";
import { PLACE_REFERENCE_PT, placedDrawing, resizedDrawing } from "./drawingPlacement";

const PAGE = { width: 800, height: 400 };

describe("placedDrawing", () => {
  it("centres the item on the click and sizes it from its natural width", () => {
    const stroke = placedDrawing({ width: PLACE_REFERENCE_PT / 4, height: PLACE_REFERENCE_PT / 8 }, "asset-1", { x: 0.5, y: 0.5 }, PAGE, "drawing-1");

    expect(stroke).toMatchObject({ id: "drawing-1", tool: "drawing", asset: "asset-1" });
    expect(stroke?.size?.width).toBeCloseTo(0.25);
    expect(stroke?.size?.height).toBeCloseTo(0.25);
    expect(stroke?.points[0].x).toBeCloseTo(0.375);
    expect(stroke?.points[0].y).toBeCloseTo(0.375);
  });

  it("keeps the item on the page near an edge and shrinks one taller than the page", () => {
    const corner = placedDrawing({ width: 200, height: 100 }, "asset-1", { x: 0.99, y: 0.01 }, PAGE);
    expect(corner?.points[0].x).toBeCloseTo(1 - (corner?.size?.width ?? 0));
    expect(corner?.points[0].y).toBe(0);

    const tall = placedDrawing({ width: 400, height: 2000 }, "asset-1", { x: 0.5, y: 0.5 }, PAGE);
    expect(tall?.size?.height).toBeCloseTo(0.9);
    expect(((tall?.size?.width ?? 0) * PAGE.width) / ((tall?.size?.height ?? 1) * PAGE.height)).toBeCloseTo(400 / 2000);
  });

  it("places nothing for an empty item or an unmeasured page", () => {
    expect(placedDrawing({ width: 0, height: 10 }, "asset-1", { x: 0.5, y: 0.5 }, PAGE)).toBeNull();
    expect(placedDrawing({ width: 10, height: 10 }, "asset-1", { x: 0.5, y: 0.5 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe("resizedDrawing", () => {
  it("swaps in the edited picture and scales the box by its change in size", () => {
    const stroke = placedDrawing({ width: 100, height: 50 }, "asset-1", { x: 0.3, y: 0.3 }, PAGE, "drawing-1")!;

    const next = resizedDrawing(stroke, "asset-2", 2, 1);

    expect(next.asset).toBe("asset-2");
    expect(next.points).toEqual(stroke.points);
    expect(next.size?.width).toBeCloseTo((stroke.size?.width ?? 0) * 2);
    expect(next.size?.height).toBeCloseTo(stroke.size?.height ?? 0);
  });

  it("shrinks an edited picture that would run off the page, keeping its shape", () => {
    const stroke = { id: "d", tool: "drawing" as const, color: "#000000", width: 0, points: [{ x: 0.6, y: 0.1 }], size: { width: 0.3, height: 0.2 }, asset: "asset-1" };

    const next = resizedDrawing(stroke, "asset-2", 2, 2);

    expect(next.size?.width).toBeCloseTo(0.4);
    expect(next.size?.height).toBeCloseTo(0.4 * (0.2 / 0.3));
  });
});

describe("drawing geometry", () => {
  const item = { id: "d", tool: "drawing" as const, color: "#000000", width: 0, points: [{ x: 0.2, y: 0.2 }], size: { width: 0.4, height: 0.2 }, asset: "asset-1" };

  it("treats an inserted item as its whole box for picking and resizing, without rotation", () => {
    expect(drawingExtent(item)).toEqual({ left: 0.2, top: 0.2, right: expect.closeTo(0.6), bottom: expect.closeTo(0.4) });
    expect(hitsDrawing(item, { x: 0.4, y: 0.3 }, 0)).toBe(true);
    expect(hitsDrawing(item, { x: 0.7, y: 0.3 }, 0)).toBe(false);
    expect(scaleDrawing(item, { x: 0.2, y: 0.2 }, 2, 2).size).toEqual({ width: 0.8, height: 0.4 });
    expect(canRotate(item)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { boundsOf, curveFromVertices, curvedVertices, currentCurve, lineEndpoints, polylineFromLine } from "./lineCurve";

const start = { x: 0, y: 0 };
const end = { x: 100, y: 0 };

describe("curvedVertices", () => {
  it("returns only the two endpoints when there is no curve", () => {
    expect(curvedVertices(start, end, 0)).toEqual([start, end]);
  });

  it("keeps the endpoints in place when bent", () => {
    const vertices = curvedVertices(start, end, 50);
    expect(vertices[0]).toEqual(start);
    expect(vertices[vertices.length - 1]).toEqual(end);
  });

  it("bends to opposite sides for opposite signs", () => {
    const up = curvedVertices(start, end, 40);
    const down = curvedVertices(start, end, -40);
    expect(Math.sign(up[6].y)).toBe(-Math.sign(down[6].y));
  });

  it("bends further as the curve grows", () => {
    const gentle = curvedVertices(start, end, 20)[6];
    const strong = curvedVertices(start, end, 80)[6];
    expect(Math.abs(strong.y)).toBeGreaterThan(Math.abs(gentle.y));
  });
});

describe("curveFromVertices", () => {
  it("reads back the curve it was built with", () => {
    for (const curve of [-100, -35, 15, 60, 100]) {
      expect(curveFromVertices(curvedVertices(start, end, curve))).toBe(curve);
    }
  });

  it("reports no curve for a straight two point run", () => {
    expect(curveFromVertices([start, end])).toBe(0);
  });

  it("reports no curve when both ends sit on the same spot", () => {
    expect(curveFromVertices([start, start, start])).toBe(0);
  });
});

describe("boundsOf", () => {
  it("covers every point and adds the padding", () => {
    expect(boundsOf([{ x: 10, y: 20 }, { x: 30, y: 5 }], 2)).toEqual({
      origin: { x: 8, y: 3 },
      size: { width: 24, height: 19 },
    });
  });
});

const line = {
  id: "a1",
  type: PdfAnnotationSubtype.LINE,
  pageIndex: 0,
  rect: { origin: { x: 0, y: 0 }, size: { width: 100, height: 1 } },
  linePoints: { start, end },
  strokeWidth: 4,
  strokeColor: "#FFD400",
} as unknown as Parameters<typeof polylineFromLine>[0];

describe("polylineFromLine", () => {
  it("keeps the styling, swaps the subtype and drops the straight points", () => {
    const vertices = curvedVertices(start, end, 30);
    const polyline = polylineFromLine(line, vertices, "a2");
    expect(polyline.type).toBe(PdfAnnotationSubtype.POLYLINE);
    expect(polyline.id).toBe("a2");
    expect(polyline.strokeColor).toBe("#FFD400");
    expect(polyline.vertices).toBe(vertices);
    expect("linePoints" in polyline).toBe(false);
  });

  it("recomputes the rect around the bent run", () => {
    const polyline = polylineFromLine(line, curvedVertices(start, end, 30), "a2");
    expect(polyline.rect.size.height).toBeGreaterThan(1);
  });
});

describe("reading a selected mark", () => {
  it("takes the endpoints from either shape", () => {
    expect(lineEndpoints(line)).toEqual({ start, end });
    const polyline = polylineFromLine(line, curvedVertices(start, end, 30), "a2");
    expect(lineEndpoints(polyline)).toEqual({ start, end });
  });

  it("reports a straight line as uncurved and a bent polyline by its curve", () => {
    expect(currentCurve(line)).toBe(0);
    expect(currentCurve(polylineFromLine(line, curvedVertices(start, end, 45), "a2"))).toBe(45);
  });
});

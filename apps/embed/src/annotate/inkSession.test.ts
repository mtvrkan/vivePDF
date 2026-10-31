import { describe, expect, it } from "vitest";
import { continuesDrawing, joinStrokes, type InkStyle, type OpenDrawing } from "./inkSession";

const pen: InkStyle = { toolId: "ink", strokeColor: "#E44234", strokeWidth: 4 };
const open: OpenDrawing = { ...pen, pageIndex: 0, id: "a" };
const target = { strokeColor: "#E44234", strokeWidth: 4, inkList: [{ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }] };

describe("joining pen strokes", () => {
  it("adds the new stroke after the old ones and grows the box around all of them", () => {
    const joined = joinStrokes(target.inkList, [{ points: [{ x: 50, y: 5 }, { x: 60, y: 40 }] }], 4);

    expect(joined.inkList).toHaveLength(2);
    expect(joined.rect).toEqual({ origin: { x: 8, y: 3 }, size: { width: 54, height: 39 } });
  });

  it("keeps drawing on the same page with the same tool, colour and width", () => {
    expect(continuesDrawing(open, 0, pen, target)).toBe(true);
  });

  it("starts a new drawing on another page, with another tool or another style", () => {
    const checks = [
      continuesDrawing(open, 1, pen, target),
      continuesDrawing(open, 0, { ...pen, toolId: "inkHighlighter" }, target),
      continuesDrawing(open, 0, { ...pen, strokeColor: "#1F6FEB" }, target),
      continuesDrawing(open, 0, { ...pen, strokeWidth: 8 }, target),
    ];

    expect(checks).toEqual([false, false, false, false]);
  });

  it("starts a new drawing when the old one is gone or was restyled", () => {
    const checks = [continuesDrawing(null, 0, pen, target), continuesDrawing(open, 0, pen, null), continuesDrawing(open, 0, pen, { ...target, strokeColor: "#2EA043" })];

    expect(checks).toEqual([false, false, false]);
  });
});

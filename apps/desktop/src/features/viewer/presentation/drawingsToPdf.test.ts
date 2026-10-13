import { describe, expect, it } from "vitest";
import type { Stroke } from "@/shared/store/presentationStore";
import { hasPresentationDrawings, presentationDrawings } from "./drawingsToPdf";
import { readableOnDark } from "./strokes";

const BOARD = { width: 1600, height: 900 };

function pen(id: string, color = "#ff0000", points = [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]): Stroke {
  return { id, tool: "pen", color, width: 0.01, points };
}

const empty = { strokesByPage: {}, boardStrokes: { black: [], white: [] } };

describe("presentationDrawings", () => {
  it("turns page and board drawings into one-based pages and sized boards", () => {
    const note: Stroke = { id: "t", tool: "text", color: "#000000", width: 0, points: [{ x: 0.3, y: 0.3 }], text: "Hi", fontSize: 0.02, size: { width: 0.1, height: 0.05 } };

    const drawings = presentationDrawings({ strokesByPage: { 2: [pen("a"), note], 0: [pen("b", "#00ff00")] }, boardStrokes: { black: [pen("c", "#000000")], white: [] } }, BOARD);

    expect(drawings.pages.map((entry) => entry.page)).toEqual([1, 3]);
    expect(drawings.pages[1].strokes[1]).toMatchObject({ tool: "text", text: "Hi", fontSize: 0.02, size: [0.1, 0.05] });
    expect(drawings.pages[0].strokes[0].points).toEqual([[0.1, 0.1], [0.2, 0.2]]);
    expect(drawings.boards).toEqual([{ background: "black", width: 1600, height: 900, strokes: [expect.objectContaining({ color: readableOnDark("#000000") })] }]);
    expect(hasPresentationDrawings(drawings)).toBe(true);
  });

  it("drops blank text and pages left empty, and reports nothing to save", () => {
    const blank: Stroke = { id: "t", tool: "text", color: "#000000", width: 0, points: [{ x: 0.3, y: 0.3 }], text: "  ", fontSize: 0.02, size: { width: 0.1, height: 0.05 } };

    const drawings = presentationDrawings({ ...empty, strokesByPage: { 0: [blank], 1: [] } }, BOARD);

    expect(drawings).toEqual({ pages: [], boards: [] });
    expect(hasPresentationDrawings(drawings)).toBe(false);
  });

  it("thins very long strokes, splits crowded pages and replaces colours that are not plain hex", () => {
    const long = pen("long", "rgb(1, 2, 3)", Array.from({ length: 50_000 }, (_, index) => ({ x: index / 50_000, y: 0.5 })));
    const many = Array.from({ length: 2_500 }, (_, index) => pen(`p${index}`));

    const drawings = presentationDrawings({ ...empty, strokesByPage: { 0: [long, ...many] } }, BOARD);

    expect(drawings.pages.map((entry) => entry.strokes.length)).toEqual([2000, 501]);
    expect(drawings.pages[0].strokes[0].points.length).toBeLessThanOrEqual(20_000);
    expect(drawings.pages[0].strokes[0].points.at(-1)).toEqual([49_999 / 50_000, 0.5]);
    expect(drawings.pages[0].strokes[0].color).toBe("#000000");
  });
});

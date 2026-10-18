import { describe, expect, it } from "vitest";
import { boardInk, ERASER_CURSOR_COLOR, pageInk } from "./toolCursor";
import { readableOnDark } from "./strokes";

const PEN = { penColor: "#111827", penWidth: 4, highlighterColor: "#FFD400", highlighterWidth: 24, eraserSize: 48 };

describe("cursor ink", () => {
  it("uses the pen colour on the page and the fixed eraser colour for the eraser", () => {
    expect(pageInk("pen", "#E5484D")).toBe("#E5484D");
    expect(pageInk("eraser", "#E5484D")).toBe(ERASER_CURSOR_COLOR);
  });

  it("takes the board pen or highlighter colour, made readable on the black board", () => {
    expect(boardInk("white", "highlighter", PEN)).toBe("#FFD400");
    expect(boardInk("black", "pen", PEN)).toBe(readableOnDark("#111827"));
  });

  it("gives the eraser a light colour on the black board and a dark one on the white board", () => {
    expect(boardInk("black", "eraser", PEN)).not.toBe(boardInk("white", "eraser", PEN));
    expect(boardInk("white", "eraser", PEN)).toBe(ERASER_CURSOR_COLOR);
  });
});

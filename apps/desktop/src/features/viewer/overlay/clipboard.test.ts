import { describe, expect, it } from "vitest";
import { pastePosition } from "./clipboard";

describe("pastePosition", () => {
  it("offsets by 12pt when pasting onto the same page it was copied from", () => {
    expect(pastePosition({ x: 40, y: 60, width: 100, height: 30 }, 0, 0, 600, 800)).toEqual({ x: 52, y: 72 });
  });

  it("keeps the original rect when pasting onto a different page", () => {
    expect(pastePosition({ x: 40, y: 60, width: 100, height: 30 }, 0, 1, 600, 800)).toEqual({ x: 40, y: 60 });
  });

  it("clamps the paste position so the object stays on the page", () => {
    expect(pastePosition({ x: 595, y: 795, width: 100, height: 30 }, 0, 0, 600, 800)).toEqual({ x: 500, y: 770 });
  });
});

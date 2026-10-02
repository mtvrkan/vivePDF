import { describe, expect, it } from "vitest";
import { unrotatedRect } from "./pageSize";

const VISIBLE = { width: 842, height: 595 };
const BOX = { x0: 730, y0: 65, x1: 765, y1: 140 };

describe("unrotatedRect", () => {
  it("returns the box unchanged on an upright page", () => {
    expect(unrotatedRect(BOX, 0, VISIBLE)).toEqual(BOX);
  });

  it("maps a box on a page turned 90 degrees back onto the unturned page", () => {
    expect(unrotatedRect(BOX, 90, VISIBLE)).toEqual({ x0: 65, y0: 77, x1: 140, y1: 112 });
  });

  it("maps boxes on pages turned 180 and 270 degrees, including negative rotations", () => {
    expect(unrotatedRect(BOX, 180, VISIBLE)).toEqual({ x0: 77, y0: 455, x1: 112, y1: 530 });
    expect(unrotatedRect(BOX, 270, VISIBLE)).toEqual({ x0: 455, y0: 730, x1: 530, y1: 765 });
    expect(unrotatedRect(BOX, -90, VISIBLE)).toEqual(unrotatedRect(BOX, 270, VISIBLE));
  });
});

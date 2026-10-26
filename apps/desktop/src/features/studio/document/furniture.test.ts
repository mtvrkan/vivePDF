import { describe, expect, it } from "vitest";
import { furnitureOffset, numberAlign, numberLabel } from "./furniture";

describe("document header and footer", () => {
  it("centres the furniture line in the margin like the PDF does", () => {
    expect(furnitureOffset(56.69)).toBeCloseTo(20.345, 3);
  });

  it("keeps the line at least four points from the page edge in a thin margin", () => {
    expect(furnitureOffset(14)).toBe(4);
  });

  it("puts outside numbers on the right of odd pages and fills the number format", () => {
    expect(numberAlign("outside", 3)).toBe("right");
    expect(numberAlign("outside", 4)).toBe("left");
    expect(numberAlign("none", 1)).toBeNull();
    expect(numberLabel("Page {n} of {total}", 2, 9)).toBe("Page 2 of 9");
  });
});

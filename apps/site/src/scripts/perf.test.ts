import { describe, expect, it } from "vitest";
import { framesAreSlow } from "./perf";

describe("frame sampling verdict", () => {
  it("accepts a steady 60 fps window", () => {
    expect(framesAreSlow(150, 1, 2500)).toBe(false);
  });

  it("flags a window that stays under 40 fps", () => {
    expect(framesAreSlow(90, 0, 2500)).toBe(true);
  });

  it("flags frequent long frames even when the average looks fine", () => {
    expect(framesAreSlow(120, 20, 2500)).toBe(true);
  });
});

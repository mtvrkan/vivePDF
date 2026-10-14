import { describe, expect, it } from "vitest";
import { fitBox } from "./fitBox";

describe("fitBox", () => {
  it("fills the height and centres a wide screen in a wider space", () => {
    expect(fitBox({ width: 1200, height: 450 }, 16 / 9)).toEqual({ width: 800, height: 450 });
  });

  it("fills the width when the space is taller than the screen", () => {
    expect(fitBox({ width: 800, height: 900 }, 4 / 3)).toEqual({ width: 800, height: 600 });
  });

  it("returns an empty box before the space has been measured or for a broken ratio", () => {
    expect(fitBox({ width: 0, height: 500 }, 16 / 9)).toEqual({ width: 0, height: 0 });
    expect(fitBox({ width: 800, height: 500 }, Number.NaN)).toEqual({ width: 0, height: 0 });
  });
});

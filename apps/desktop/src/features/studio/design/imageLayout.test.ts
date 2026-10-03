import { describe, expect, it } from "vitest";
import { placeImage } from "./imageLayout";

const whole = { x: 0, y: 0, width: 1, height: 1 };

describe("studio image placement", () => {
  it("covers the box by cutting the long side in the middle", () => {
    const placed = placeImage({ width: 200, height: 100 }, whole, "cover", { width: 100, height: 100 });

    expect(placed.frame).toEqual({ left: 0, top: 0, width: 100, height: 100 });
    expect(placed.image).toEqual({ left: -50, top: -0, width: 200, height: 100 });
  });

  it("fits the whole picture inside the box", () => {
    const placed = placeImage({ width: 200, height: 100 }, whole, "contain", { width: 100, height: 100 });

    expect(placed.frame).toEqual({ left: 0, top: 25, width: 100, height: 50 });
    expect(placed.image.width).toBe(100);
  });

  it("stretches and applies a crop", () => {
    const placed = placeImage({ width: 200, height: 100 }, { x: 0.5, y: 0, width: 0.5, height: 1 }, "stretch", { width: 50, height: 100 });

    expect(placed.image).toEqual({ left: -50, top: -0, width: 100, height: 100 });
  });
});

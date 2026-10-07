import { describe, expect, it } from "vitest";
import { thumbnailScale } from "./thumbnailScale";

describe("thumbnailScale", () => {
  it("renders a wide slide only as large as the card needs", () => {
    expect(thumbnailScale({ width: 280, height: 364 }, { width: 960, height: 540 }, 1)).toBe(0.35);
  });

  it("asks for more pixels on a high density screen", () => {
    expect(thumbnailScale({ width: 280, height: 364 }, { width: 960, height: 540 }, 2)).toBe(0.6);
  });

  it("falls back to the width steps when the page size is unknown", () => {
    expect(thumbnailScale({ width: 200, height: 260 }, null, 1)).toBe(0.45);
  });
});

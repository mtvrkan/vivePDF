import { describe, expect, it } from "vitest";
import { movePhoto, nextRotation, rotationParams, sortPhotosByName, withRotation } from "./photoOrder";

describe("photo order", () => {
  it("moves a photo one step and ignores moves past either end", () => {
    const photos = ["a.jpg", "b.jpg", "c.jpg"];
    expect(movePhoto(photos, "c.jpg", -1)).toEqual(["a.jpg", "c.jpg", "b.jpg"]);
    expect(movePhoto(photos, "a.jpg", -1)).toBe(photos);
    expect(movePhoto(photos, "missing.jpg", 1)).toBe(photos);
  });

  it("sorts by file name with numbers in natural order", () => {
    const photos = ["C:\\x\\IMG_10.jpg", "D:\\y\\IMG_2.jpg", "C:\\x\\IMG_1.jpg"];
    expect(sortPhotosByName(photos, "tr")).toEqual(["C:\\x\\IMG_1.jpg", "D:\\y\\IMG_2.jpg", "C:\\x\\IMG_10.jpg"]);
    expect(sortPhotosByName(photos, "tr", true)[0]).toBe("C:\\x\\IMG_10.jpg");
  });

  it("turns clockwise and sends rotations only when one is set", () => {
    expect(nextRotation(undefined)).toBe(90);
    expect(nextRotation(270)).toBe(0);
    const rotations = withRotation({}, "b.jpg", 180);
    expect(rotationParams(["a.jpg", "b.jpg"], rotations)).toEqual([0, 180]);
    expect(rotationParams(["a.jpg", "b.jpg"], withRotation(rotations, "b.jpg", null))).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { imagePreviewKey, isLayerLocked, layerKey } from "./layers";

describe("isLayerLocked", () => {
  it("is true only for the locked page and object", () => {
    const locked = { [layerKey(1, "a")]: true as const };
    expect(isLayerLocked(locked, 1, "a")).toBe(true);
    expect(isLayerLocked(locked, 0, "a")).toBe(false);
    expect(isLayerLocked(locked, 1, "b")).toBe(false);
  });
});

describe("imagePreviewKey", () => {
  it("scopes previews by document", () => {
    expect(imagePreviewKey("doc-a", 2, 7)).not.toBe(imagePreviewKey("doc-b", 2, 7));
  });
});

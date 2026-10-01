import { describe, expect, it } from "vitest";
import { decideDropAction, dropHitKindFor } from "./dropRouting";

describe("decideDropAction", () => {
  it("replaces the image when a single image file drops onto an image object", () => {
    expect(decideDropAction("image", [{ name: "photo.png" }], "image")).toBe("replaceImage");
  });

  it("replaces the image when a single image file drops onto a block not yet an object", () => {
    expect(decideDropAction("text", [{ name: "photo.jpg" }], "block")).toBe("replaceImage");
  });

  it("creates a new image object when dropping onto empty page area in image mode", () => {
    expect(decideDropAction("image", [{ name: "photo.webp" }], "empty")).toBe("createImage");
  });

  it("ignores a drop onto empty page area while in text mode", () => {
    expect(decideDropAction("text", [{ name: "photo.png" }], "empty")).toBe("ignore");
  });

  it("ignores multiple files even onto an image object", () => {
    expect(decideDropAction("image", [{ name: "a.png" }, { name: "b.png" }], "image")).toBe("ignore");
  });

  it("ignores a non-image file", () => {
    expect(decideDropAction("image", [{ name: "doc.pdf" }], "image")).toBe("ignore");
  });

  it("ignores drops when the overlay is not in text or image mode", () => {
    expect(decideDropAction("none", [{ name: "photo.png" }], "image")).toBe("ignore");
  });
});

describe("dropHitKindFor", () => {
  it("maps picture objects and picture blocks to replace targets", () => {
    expect(dropHitKindFor({ source: "object", kind: "imageChange" }, true)).toBe("image");
    expect(dropHitKindFor({ source: "object", kind: "image" }, true)).toBe("image");
    expect(dropHitKindFor({ source: "block", kind: "image" }, true)).toBe("block");
  });

  it("does not treat text as a drop target", () => {
    expect(dropHitKindFor({ source: "object", kind: "block" }, true)).toBeNull();
    expect(dropHitKindFor({ source: "block", kind: "text" }, true)).toBeNull();
  });

  it("falls back to empty page or outside page", () => {
    expect(dropHitKindFor(null, true)).toBe("empty");
    expect(dropHitKindFor(null, false)).toBe("outside-page");
  });
});

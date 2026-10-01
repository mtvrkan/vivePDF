import { describe, expect, it } from "vitest";
import { pickLayerHit, resolveOverlayHit, type HitCandidate } from "./hitTest";

const PAGE_AREA = 720 * 540;

describe("resolveOverlayHit", () => {
  it("prefers the text block over a full-page background image", () => {
    const candidates: HitCandidate[] = [
      { id: "image", kind: "image", rect: { x: 0, y: 0, width: 720, height: 540 } },
      { id: "text", kind: "text", rect: { x: 100, y: 100, width: 200, height: 40 } },
    ];
    expect(resolveOverlayHit({ x: 150, y: 110 }, candidates, PAGE_AREA)).toBe("text");
  });

  it("hits the background image where no text block is present", () => {
    const candidates: HitCandidate[] = [
      { id: "image", kind: "image", rect: { x: 0, y: 0, width: 720, height: 540 } },
      { id: "text", kind: "text", rect: { x: 100, y: 100, width: 200, height: 40 } },
    ];
    expect(resolveOverlayHit({ x: 500, y: 400 }, candidates, PAGE_AREA)).toBe("image");
  });

  it("applies smallest-area-wins for an image below the background threshold", () => {
    const candidates: HitCandidate[] = [
      { id: "image", kind: "image", rect: { x: 0, y: 0, width: 300, height: 200 } },
      { id: "text", kind: "text", rect: { x: 50, y: 50, width: 80, height: 30 } },
    ];
    expect(resolveOverlayHit({ x: 60, y: 60 }, candidates, PAGE_AREA)).toBe("text");
    expect(resolveOverlayHit({ x: 250, y: 150 }, candidates, PAGE_AREA)).toBe("image");
  });

  it("switches selection away from a selected image to the text block underneath", () => {
    const candidates: HitCandidate[] = [
      { id: "selected-image", kind: "image", rect: { x: 0, y: 0, width: 720, height: 540 } },
      { id: "paragraph", kind: "text", rect: { x: 40, y: 40, width: 150, height: 60 } },
    ];
    expect(resolveOverlayHit({ x: 50, y: 50 }, candidates, PAGE_AREA)).toBe("paragraph");
  });

  it("prefers a nested text block over a fully containing image regardless of area ratio", () => {
    const candidates: HitCandidate[] = [
      { id: "container-image", kind: "image", rect: { x: 0, y: 0, width: 400, height: 400 } },
      { id: "nested-text", kind: "text", rect: { x: 40, y: 40, width: 60, height: 20 } },
    ];
    expect(resolveOverlayHit({ x: 50, y: 45 }, candidates, PAGE_AREA)).toBe("nested-text");
  });

  it("text mode never resolves an image, even without overlapping text", () => {
    const candidates: HitCandidate[] = [{ id: "image", kind: "image", rect: { x: 0, y: 0, width: 720, height: 540 } }];
    expect(resolveOverlayHit({ x: 500, y: 400 }, candidates, PAGE_AREA, 0, "text")).toBeNull();
  });

  it("image mode never resolves a text block, even when it is smaller and on top", () => {
    const candidates: HitCandidate[] = [
      { id: "image", kind: "image", rect: { x: 0, y: 0, width: 720, height: 540 } },
      { id: "text", kind: "text", rect: { x: 100, y: 100, width: 200, height: 40 } },
    ];
    expect(resolveOverlayHit({ x: 150, y: 110 }, candidates, PAGE_AREA, 0, "image")).toBe("image");
  });
});

describe("pickLayerHit", () => {
  const background = { id: "bg", kind: "image" as const, rect: { x: 0, y: 0, width: 720, height: 540 }, value: "background-block" };
  const paragraph = { id: "p", kind: "text" as const, rect: { x: 100, y: 100, width: 200, height: 40 }, value: "paragraph-block" };
  const logo = { id: "logo", kind: "image" as const, rect: { x: 400, y: 20, width: 80, height: 60 }, value: "logo-object" };

  it("routes a point over text on a background picture to the text, as a click does", () => {
    expect(pickLayerHit({ x: 150, y: 110 }, [], [background, paragraph], PAGE_AREA, 2)).toEqual({ source: "block", value: "paragraph-block" });
  });

  it("returns the background picture where there is no text", () => {
    expect(pickLayerHit({ x: 600, y: 400 }, [], [background, paragraph], PAGE_AREA, 2)).toEqual({ source: "block", value: "background-block" });
  });

  it("prefers a smaller pending object over the block beneath it", () => {
    expect(pickLayerHit({ x: 420, y: 40 }, [logo], [background], PAGE_AREA, 2)).toEqual({ source: "object", value: "logo-object" });
  });

  it("filters by kind when the mode allows only one", () => {
    expect(pickLayerHit({ x: 150, y: 110 }, [], [background, paragraph], PAGE_AREA, 2, "image")).toEqual({ source: "block", value: "background-block" });
    expect(pickLayerHit({ x: 600, y: 400 }, [], [background, paragraph], PAGE_AREA, 2, "text")).toBeNull();
  });
});

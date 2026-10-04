import { describe, expect, it } from "vitest";
import { createImage } from "../model/design";
import { draftCrop, finishDraft, initialDraft, moveDraft, resetDraft, resizeFrame, toContent, zoomDraft, zoomOf, type CropDraft } from "./cropMath";
import { placeImage } from "./imageLayout";

const NATURAL = { width: 400, height: 200 };

function draftFor(overrides: Partial<ReturnType<typeof createImage>> = {}): CropDraft {
  return initialDraft(NATURAL, { ...createImage("a.png", 10, 20, 100, 100), ...overrides });
}

describe("crop math", () => {
  it("starts from the cover placement and applies back to the same picture", () => {
    const element = { ...createImage("a.png", 10, 20, 100, 100), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } };
    const draft = initialDraft(NATURAL, element);

    const patch = finishDraft(draft);

    expect(draft.image).toEqual({ left: -50, top: 0, width: 200, height: 100 });
    expect(zoomOf(draft)).toBe(1);
    expect(patch).toEqual({ x: 10, y: 20, width: 100, height: 100, fit: "cover", crop: { x: 0.25, y: 0, width: 0.5, height: 1 } });
    expect(Object.values(placeImage(NATURAL, patch.crop, "cover", patch).image).map((value) => value + 0)).toEqual(Object.values(draft.image));
  });

  it("moves the picture but never leaves an empty edge in the frame", () => {
    const draft = draftFor();

    expect(moveDraft(draft, { x: 30, y: 0 }).image.left).toBe(-20);
    expect(moveDraft(draft, { x: 500, y: 40 }).image).toMatchObject({ left: 0, top: 0 });
    expect(moveDraft(draft, { x: -500, y: 0 }).image.left).toBe(-100);
  });

  it("zooms around the frame centre and keeps cover as the smallest zoom", () => {
    const draft = draftFor();

    const closer = zoomDraft(draft, 2);
    const tooFar = zoomDraft(draft, 0.2);

    expect(closer.image).toEqual({ left: -150, top: -50, width: 400, height: 200 });
    expect(zoomOf(closer)).toBe(2);
    expect(tooFar.image).toEqual(draft.image);
    expect(zoomOf(zoomDraft(draft, 50))).toBe(10);
  });

  it("drags frame edges within the picture and keeps the picture fixed on the page", () => {
    const draft = draftFor();

    const wider = resizeFrame(draft, "e", { x: 30, y: 0 });
    const capped = resizeFrame(draft, "w", { x: -300, y: 0 });
    const shorter = resizeFrame(draft, "n", { x: 0, y: 40 });

    expect(wider).toMatchObject({ x: 10, width: 130 });
    expect(wider.image.left).toBe(-50);
    expect(capped).toMatchObject({ x: -40, width: 150 });
    expect(capped.image.left).toBe(0);
    expect(shorter).toMatchObject({ y: 60, height: 60, image: { top: -40 } });
    expect(draftCrop(shorter)).toEqual({ x: 0.25, y: 0.4, width: 0.5, height: 0.6 });
  });

  it("resizes in the element's own turned and flipped frame", () => {
    const turned = draftFor({ rotation: 90 });
    const flipped = draftFor({ flipX: true });

    const grown = resizeFrame(turned, "e", toContent({ x: 0, y: 20 }, turned));
    const mirrored = resizeFrame(flipped, "e", toContent({ x: -20, y: 0 }, flipped));

    expect(toContent({ x: 0, y: 20 }, turned)).toEqual({ x: expect.closeTo(20), y: expect.closeTo(0) });
    expect(grown.width).toBeCloseTo(120);
    expect(grown.x + grown.width / 2).toBeCloseTo(60);
    expect(grown.y + grown.height / 2).toBeCloseTo(80);
    expect(mirrored).toMatchObject({ width: 120 });
    expect(mirrored.x).toBeCloseTo(-10);
  });

  it("keeps a minimal frame and resets to the centred picture", () => {
    const draft = moveDraft(zoomDraft(draftFor(), 3), { x: 40, y: 40 });

    const tiny = resizeFrame(draft, "se", { x: -500, y: -500 });
    const reset = resetDraft(draft, NATURAL);

    expect(tiny).toMatchObject({ width: 2, height: 2 });
    expect(reset.image).toEqual({ left: -50, top: 0, width: 200, height: 100 });
  });
});

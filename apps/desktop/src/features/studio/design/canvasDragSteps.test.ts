import { describe, expect, it } from "vitest";
import type { StudioDesign, StudioElement, StudioTextElement } from "@/types/studio";
import { createDesign, createQr, createShape, createText } from "../model/design";
import { snapIndexFor } from "./canvasGeometry";
import { moveStep, resizeStep, turnStep, type StepContext } from "./canvasDragSteps";

function designWith(elements: StudioElement[]): StudioDesign {
  const design = createDesign("Test", 200, 200);
  return { ...design, pages: [{ ...design.pages[0], elements }] };
}

function context(design: StudioDesign, point: { x: number; y: number }, fields: Partial<StepContext> = {}): StepContext {
  return { pageId: design.pages[0].id, point, shiftKey: false, altKey: false, snap: false, tolerance: 1, number: (value) => value.toFixed(0), degrees: (angle) => `${angle.toFixed(0)}°`, ...fields };
}

function placedElement(design: StudioDesign, id: string): StudioElement | undefined {
  return design.pages[0].elements.find((element) => element.id === id);
}

describe("canvas drag steps", () => {
  it("scales a text's font with a corner resize and reads out the new size", () => {
    const text = createText(10, 10, 100, 20, "Hello", { fontSize: 12 });
    const design = designWith([text]);
    const index = snapIndexFor(design.pages[0], design, new Set([text.id]));

    const step = resizeStep({ kind: "resize", before: design, handle: "se", elements: [text], origin: { x: 110, y: 30 }, start: { x: 10, y: 10, width: 100, height: 20 }, index }, context(design, { x: 210, y: 50 }));

    const resized = placedElement(step.preview(design), text.id) as StudioTextElement;
    expect(resized.width).toBe(200);
    expect(resized.fontSize).toBe(24);
    expect(step.feedback.readout?.text).toMatch(/^200 × /);
  });

  it("keeps a QR code square while moving several elements by the dragged distance", () => {
    const qr = createQr("https://example.org", 20, 20, 40);
    const shape = createShape("rect", 100, 100, 30, 30);
    const design = designWith([qr, shape]);
    const index = snapIndexFor(design.pages[0], design, new Set([qr.id]));

    const squared = resizeStep({ kind: "resize", before: design, handle: "e", elements: [qr], origin: { x: 60, y: 40 }, start: { x: 20, y: 20, width: 40, height: 40 }, index }, context(design, { x: 80, y: 40 })).preview(design);
    const moved = moveStep(
      { kind: "move", before: design, base: design, ids: [qr.id, shape.id], original: [qr.id, shape.id], origin: { x: 0, y: 0 }, moved: true, duplicate: false, index, start: { x: 20, y: 20, width: 110, height: 110 }, anchor: { x: 20, y: 20 } },
      context(design, { x: 5, y: 7 }),
      { x: 5, y: 7 },
    ).preview(design);

    expect(placedElement(squared, qr.id)).toMatchObject({ width: 60, height: 60 });
    expect(placedElement(moved, qr.id)).toMatchObject({ x: 25, y: 27 });
    expect(placedElement(moved, shape.id)).toMatchObject({ x: 105, y: 107 });
  });

  it("reports the turn of a group and leaves the design untouched at zero degrees", () => {
    const first = createShape("rect", 0, 0, 20, 20);
    const second = createShape("rect", 40, 0, 20, 20);
    const design = designWith([first, second]);
    const box = { x: 0, y: 0, width: 60, height: 20 };

    const step = turnStep({ kind: "turn", before: design, elements: [first, second], centre: { x: 30, y: 10 }, origin: { x: 60, y: 10 }, box }, context(design, { x: 60, y: 10 }));

    expect(step.turn).toEqual({ box, angle: 0 });
    expect(step.feedback.readout?.text).toBe("0°");
    expect(placedElement(step.preview(design), first.id)).toMatchObject({ x: 0, y: 0, rotation: 0 });
  });
});

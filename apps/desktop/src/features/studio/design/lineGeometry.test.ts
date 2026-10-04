import { describe, expect, it } from "vitest";
import { createShape } from "../model/design";
import { lineBetween, lineEndpoints, moveLineEnd, stepLineAngle } from "./lineGeometry";

describe("line endpoints", () => {
  it("finds both ends of a turned line from its box", () => {
    const line = { ...createShape("line", 50, 92, 100, 16), rotation: 90 };

    const ends = lineEndpoints(line);

    expect(ends.start.x).toBeCloseTo(100);
    expect(ends.start.y).toBeCloseTo(50);
    expect(ends.end.x).toBeCloseTo(100);
    expect(ends.end.y).toBeCloseTo(150);
  });

  it("moves one end and keeps the other one where it was", () => {
    const line = createShape("line", 0, 92, 200, 16);

    const patch = moveLineEnd(line, "end", { x: 0, y: 300 });
    const ends = lineEndpoints({ ...line, ...patch });

    expect(patch.width).toBeCloseTo(200);
    expect(patch.rotation).toBeCloseTo(90);
    expect(ends.start.x).toBeCloseTo(0);
    expect(ends.start.y).toBeCloseTo(100);
    expect(ends.end.y).toBeCloseTo(300);
  });

  it("keeps the start as the start when the start end is dragged past the other end", () => {
    const line = createShape("line", 0, 92, 200, 16);

    const patch = moveLineEnd(line, "start", { x: 300, y: 100 });
    const ends = lineEndpoints({ ...line, ...patch });

    expect(Math.abs(patch.rotation)).toBeCloseTo(180);
    expect(ends.start.x).toBeCloseTo(300);
    expect(ends.end.x).toBeCloseTo(200);
  });

  it("snaps the angle to 15 degree steps while keeping the length", () => {
    const stepped = stepLineAngle({ x: 0, y: 0 }, { x: 100, y: 20 });

    expect(Math.hypot(stepped.x, stepped.y)).toBeCloseTo(Math.hypot(100, 20));
    expect((Math.atan2(stepped.y, stepped.x) * 180) / Math.PI).toBeCloseTo(15);
    expect(moveLineEnd(createShape("line", 0, 0, 100, 10), "end", { x: 100, y: 52 }, { step: true }).rotation).toBeCloseTo(30);
  });

  it("never collapses a line below the smallest side", () => {
    const patch = lineBetween({ x: 10, y: 10 }, { x: 10, y: 10 }, 16);

    expect(patch.width).toBe(2);
    expect(patch.rotation).toBe(0);
    expect(patch.y).toBe(2);
  });
});

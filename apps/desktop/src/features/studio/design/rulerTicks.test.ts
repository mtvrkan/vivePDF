import { describe, expect, it } from "vitest";
import { MIN_LABEL_GAP_PX, pixelsPerMm, rulerSteps, rulerTicks } from "./rulerTicks";

describe("ruler ticks", () => {
  it("labels millimetres more densely as the zoom grows", () => {
    expect(rulerSteps(1)).toEqual({ major: 20, minor: 2 });
    expect(rulerSteps(8)).toEqual({ major: 5, minor: 0.5 });
    expect(rulerSteps(0.05)).toEqual({ major: 500, minor: 50 });
    for (const zoom of [0.05, 0.3, 1, 2.5, 8]) expect(rulerSteps(zoom).major * pixelsPerMm(zoom)).toBeGreaterThanOrEqual(MIN_LABEL_GAP_PX);
  });

  it("starts at the page origin and follows the scroll", () => {
    const ticks = rulerTicks(100, 300, 1);

    expect(ticks.find((tick) => tick.value === 0)).toEqual({ offset: 100, kind: "major", value: 0 });
    expect(ticks.find((tick) => tick.value === 10)?.kind).toBe("mid");
    expect(ticks.find((tick) => tick.value === 2)?.kind).toBe("minor");
    expect(ticks.find((tick) => tick.value === 20)?.offset).toBeCloseTo(100 + 20 * pixelsPerMm(1));
    expect(ticks[0].value).toBeLessThan(0);
    expect(ticks.every((tick) => tick.offset >= 0 && tick.offset <= 300)).toBe(true);
    expect(rulerTicks(-500, 300, 1).every((tick) => tick.value > 0)).toBe(true);
  });

  it("draws nothing for an empty or broken ruler", () => {
    expect(rulerTicks(0, 0, 1)).toEqual([]);
    expect(rulerTicks(0, 300, 0)).toEqual([]);
    expect(rulerTicks(0, Number.NaN, 1)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { OVERSCAN, WINDOW_FROM, outputWindow, visibleSpan } from "./outputWindow";

describe("outputWindow", () => {
  it("renders every row of a short list", () => {
    expect(outputWindow(WINDOW_FROM - 1, 500, 300, 36)).toEqual({ start: 0, end: WINDOW_FROM - 1, paddingTop: 0, paddingBottom: 0 });
  });

  it("renders only the rows in view plus overscan and pads the rest", () => {
    const view = outputWindow(1000, 3600, 360, 36);
    expect(view.start).toBe(100 - OVERSCAN);
    expect(view.end).toBe(110 + OVERSCAN);
    expect(view.paddingTop + (view.end - view.start) * 36 + view.paddingBottom).toBe(1000 * 36);
  });

  it("clamps at both ends of the list", () => {
    expect(outputWindow(200, -50, 360, 36).start).toBe(0);
    const bottom = outputWindow(200, 999999, 360, 36);
    expect(bottom.end).toBe(200);
    expect(bottom.paddingBottom).toBe(0);
    expect(bottom.end - bottom.start).toBeGreaterThanOrEqual(10);
  });

  it("draws one screenful at most before the list has been measured", () => {
    expect(outputWindow(500, 0, 0, 36).end).toBe(WINDOW_FROM);
    expect(outputWindow(500, 0, 300, 0).end).toBe(WINDOW_FROM);
  });
});

describe("visibleSpan", () => {
  it("measures from the top of the rows when the page itself scrolls the list", () => {
    expect(visibleSpan(-3600, 1000, 0, 800)).toEqual({ scrollTop: 3600, viewport: 800 });
  });

  it("follows the list's own scroll when the list is the scroller", () => {
    expect(visibleSpan(200, 600, 720, 800)).toEqual({ scrollTop: 720, viewport: 400 });
  });

  it("keeps a one pixel span when the list is off screen", () => {
    expect(visibleSpan(900, 5000, 0, 800).viewport).toBe(1);
    expect(visibleSpan(-5000, -100, 0, 800).viewport).toBe(1);
  });
});

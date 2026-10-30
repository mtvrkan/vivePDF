import { describe, expect, it } from "vitest";
import { createScrollHider } from "./scrollHider";

describe("createScrollHider", () => {
  it("hides after scrolling down past the threshold and shows again on the way up", () => {
    const hider = createScrollHider(24);

    const states = [10, 20, 40, 30, 10].map(hider);

    expect(states).toEqual([false, false, true, true, false]);
  });

  it("ignores small jitter in both directions", () => {
    const hider = createScrollHider(24);

    const states = [10, 5, 15, 8, 20].map(hider);

    expect(states).toEqual([false, false, false, false, false]);
  });

  it("always shows at the top of the document", () => {
    const hider = createScrollHider(24);
    hider(200);
    hider(400);

    const atTop = hider(0);

    expect(atTop).toBe(false);
  });
});

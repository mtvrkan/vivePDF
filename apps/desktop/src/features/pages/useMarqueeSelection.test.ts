import { describe, expect, it } from "vitest";
import { boxBetween, combineSelection, hitKeys, intersects, marqueeModeOf } from "./useMarqueeSelection";

describe("marqueeModeOf", () => {
  it("replaces the selection on a plain drag", () => {
    expect(marqueeModeOf({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe("replace");
  });

  it("toggles with Ctrl and adds with Shift", () => {
    expect(marqueeModeOf({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe("toggle");
    expect(marqueeModeOf({ ctrlKey: false, metaKey: false, shiftKey: true })).toBe("add");
  });
});

describe("boxBetween", () => {
  it("normalises a drag that goes up and to the left", () => {
    expect(boxBetween({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ left: 10, top: 20, width: 40, height: 60 });
  });
});

describe("intersects", () => {
  const tile = { left: 100, top: 100, width: 50, height: 50 };

  it("hits a tile the box only grazes", () => {
    expect(intersects({ left: 140, top: 140, width: 30, height: 30 }, tile)).toBe(true);
  });

  it("misses a tile that only shares an edge", () => {
    expect(intersects({ left: 150, top: 100, width: 20, height: 20 }, tile)).toBe(false);
  });
});

describe("combineSelection", () => {
  const base = new Set(["a", "b"]);

  it("keeps only the hits when replacing", () => {
    expect([...combineSelection(base, ["c"], "replace")]).toEqual(["c"]);
  });

  it("adds hits to what was selected", () => {
    expect([...combineSelection(base, ["b", "c"], "add")].sort()).toEqual(["a", "b", "c"]);
  });

  it("flips hits against what was selected", () => {
    expect([...combineSelection(base, ["b", "c"], "toggle")].sort()).toEqual(["a", "c"]);
  });

  it("leaves the base untouched", () => {
    combineSelection(base, ["a"], "toggle");
    expect([...base]).toEqual(["a", "b"]);
  });
});

describe("hitKeys", () => {
  const tiles = [
    { key: "a", rect: { left: 0, top: 0, width: 100, height: 100 } },
    { key: "b", rect: { left: 120, top: 0, width: 100, height: 100 } },
    { key: "c", rect: { left: 0, top: 120, width: 100, height: 100 } },
  ];

  it("returns the tiles the box touches in page order", () => {
    expect(hitKeys({ left: 50, top: 50, width: 100, height: 100 }, tiles)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for a box in the gap between tiles", () => {
    expect(hitKeys({ left: 101, top: 101, width: 18, height: 18 }, tiles)).toEqual([]);
  });

  it("returns nothing when there are no tiles", () => {
    expect(hitKeys({ left: 0, top: 0, width: 500, height: 500 }, [])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { rovingTarget } from "./roving";

describe("rovingTarget", () => {
  it("moves to the next and the previous item with the arrow keys", () => {
    const moves = [rovingTarget("ArrowRight", 1, 4), rovingTarget("ArrowLeft", 1, 4), rovingTarget("ArrowDown", 2, 4), rovingTarget("ArrowUp", 2, 4)];

    expect(moves).toEqual([2, 0, 3, 1]);
  });

  it("wraps around the ends and jumps with Home and End", () => {
    const moves = [rovingTarget("ArrowRight", 3, 4), rovingTarget("ArrowLeft", 0, 4), rovingTarget("Home", 2, 4), rovingTarget("End", 0, 4)];

    expect(moves).toEqual([0, 3, 0, 3]);
  });

  it("ignores other keys, empty groups and an item that is not in the group", () => {
    const moves = [rovingTarget("Enter", 1, 4), rovingTarget("ArrowRight", 0, 0), rovingTarget("ArrowRight", -1, 4)];

    expect(moves).toEqual([null, null, null]);
  });
});

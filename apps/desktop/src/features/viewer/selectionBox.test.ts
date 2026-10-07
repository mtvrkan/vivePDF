import { describe, expect, it } from "vitest";
import { selectionBoxOf } from "./selectionBox";

const rect = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, size: { width, height } });

describe("selectionBoxOf", () => {
  it("spans every line, not only the last one", () => {
    expect(selectionBoxOf([rect(10, 10, 200, 12), rect(10, 24, 40, 12), rect(10, 38, 80, 12)])).toEqual({ x: 10, y: 10, right: 210, bottom: 50 });
  });

  it("returns the single rectangle as is", () => {
    expect(selectionBoxOf([rect(5, 6, 7, 8)])).toEqual({ x: 5, y: 6, right: 12, bottom: 14 });
  });

  it("gives nothing for an empty selection", () => {
    expect(selectionBoxOf([])).toBeNull();
  });
});

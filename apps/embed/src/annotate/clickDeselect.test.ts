import { describe, expect, it } from "vitest";
import { shouldDeselectAfterClick } from "./clickDeselect";

describe("shouldDeselectAfterClick", () => {
  it("deselects when a click beside the page left the same marks selected", () => {
    expect(shouldDeselectAfterClick(["line"], ["line"])).toBe(true);
    expect(shouldDeselectAfterClick(["a", "b"], ["b", "a"])).toBe(true);
  });

  it("keeps a mark the same click just selected or created", () => {
    expect(shouldDeselectAfterClick([], ["line"])).toBe(false);
    expect(shouldDeselectAfterClick([], ["new-text-box"])).toBe(false);
    expect(shouldDeselectAfterClick(["old"], ["new"])).toBe(false);
    expect(shouldDeselectAfterClick(["a"], ["a", "b"])).toBe(false);
  });

  it("has nothing to do when nothing is selected", () => {
    expect(shouldDeselectAfterClick([], [])).toBe(false);
    expect(shouldDeselectAfterClick(["gone"], [])).toBe(false);
  });
});

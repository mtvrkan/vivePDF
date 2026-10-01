import { describe, expect, it } from "vitest";
import { appendDigit, emptyJumpState, isJumpDigit, resolveJumpPage } from "./pageJump";

describe("digit page jump", () => {
  it("builds a buffer and resolves it clamped to the total page count", () => {
    let state = emptyJumpState();
    state = appendDigit(state, "1");
    state = appendDigit(state, "2");
    expect(resolveJumpPage(state, 50)).toBe(12);
    expect(resolveJumpPage(state, 5)).toBe(5);
  });

  it("drops a leading zero so typing 0 then 3 resolves to page 3", () => {
    let state = emptyJumpState();
    state = appendDigit(state, "0");
    state = appendDigit(state, "3");
    expect(resolveJumpPage(state, 10)).toBe(3);
  });

  it("rejects non-digit keys and an empty buffer", () => {
    expect(isJumpDigit("a")).toBe(false);
    expect(isJumpDigit("5")).toBe(true);
    expect(resolveJumpPage(emptyJumpState(), 10)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { toggleOption } from "./multiSelect";

describe("toggleOption", () => {
  const options = ["Red", "Green", "Blue"];

  it("adds a choice and keeps the list in option order", () => {
    expect(toggleOption(options, ["Blue"], "Red", true)).toEqual(["Red", "Blue"]);
  });

  it("removes a choice", () => {
    expect(toggleOption(options, ["Red", "Blue"], "Red", false)).toEqual(["Blue"]);
  });

  it("starts from nothing when the current value is not a list", () => {
    expect(toggleOption(options, "Red", "Green", true)).toEqual(["Green"]);
    expect(toggleOption(options, undefined, "Purple", true)).toEqual([]);
  });
});

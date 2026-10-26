import { describe, expect, it } from "vitest";
import { checksByGroup, clampRule, localNumber, presetOf, presetRules } from "./thesisCheckRules";

describe("thesis check rules", () => {
  it("builds the left 3.5 cm rules from the Studio thesis layout and recognises them again", () => {
    const rules = presetRules("left35");

    expect(rules.marginsMm).toEqual({ top: 30, bottom: 30, left: 35, right: 25 });
    expect(rules).toMatchObject({ paper: "a4", fontFamily: "Times New Roman", fontSize: 12, lineHeight: 1.5, pageNumbers: "center", frontRoman: true });
    expect(presetOf(rules)).toBe("left35");
    expect(presetOf({ ...rules, fontFamily: " times new roman " })).toBe("left35");
  });

  it("calls any edited value custom and keeps numbers inside their limits", () => {
    const rules = presetRules("left40");

    expect(presetOf({ ...rules, mirrored: true })).toBe("custom");
    expect(clampRule(500, [0, 100])).toBe(100);
    expect(clampRule(Number.NaN, [0.8, 3])).toBe(0.8);
  });

  it("formats measured numbers for the reader and groups checks in report order", () => {
    expect(localNumber("29.9", "tr")).toBe("29,9");
    expect(localNumber("12", "de")).toBe("12");
    expect(localNumber("210×297", "tr")).toBe("210×297");
    expect(localNumber(null, "en")).toBe("");
    const groups = checksByGroup([
      { id: "pageNumbers", status: "pass", pages: [], pageTotal: 0, expected: null, found: null },
      { id: "marginLeft", status: "fail", pages: [2], pageTotal: 1, expected: "40.0", found: "30.0" },
    ]);
    expect(groups.map((group) => group.group)).toEqual(["layout", "numbers"]);
  });
});

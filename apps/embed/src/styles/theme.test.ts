import { describe, expect, it } from "vitest";
import { parseThemeSetting, resolveTheme } from "./theme";

describe("theme", () => {
  it("reads light, dark and auto and treats anything else as light", () => {
    const settings = ["dark", "auto", "light", "neon", null].map(parseThemeSetting);

    expect(settings).toEqual(["dark", "auto", "light", "light", "light"]);
  });

  it("follows the system only in auto", () => {
    const themes = [resolveTheme("auto", true), resolveTheme("auto", false), resolveTheme("light", true)];

    expect(themes).toEqual(["dark", "light", "light"]);
  });
});

import { describe, expect, it } from "vitest";
import { profileLabelKey } from "./compressProfiles";

describe("profileLabelKey", () => {
  it("names a regular profile by its card title", () => {
    expect(profileLabelKey("strong")).toBe("tools.compress.profiles.strong.title");
  });

  it("names the extra target-size steps", () => {
    expect(profileLabelKey("minimalGray")).toBe("tools.compress.ladder.minimalGray");
  });

  it("gives nothing for the kept original or a privacy-only pass", () => {
    expect(profileLabelKey("original")).toBeNull();
    expect(profileLabelKey("privacyOnly")).toBeNull();
  });
});

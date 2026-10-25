import { describe, expect, it } from "vitest";
import { launchRequest, withoutLaunchRequest } from "./launchPanel";

describe("launchRequest", () => {
  it("opens a known side panel named in the address", () => {
    const request = launchRequest(new URLSearchParams("panel=attachments"));

    expect(request).toEqual({ panel: "attachments", print: false });
  });

  it("asks for the print dialog without a panel", () => {
    const request = launchRequest(new URLSearchParams("action=print"));

    expect(request).toEqual({ panel: null, print: true });
  });

  it("ignores a panel that cannot be opened from a shortcut", () => {
    const request = launchRequest(new URLSearchParams("panel=present&action=delete"));

    expect(request).toEqual({ panel: null, print: false });
  });

  it("drops only the launch keys from the address", () => {
    const params = withoutLaunchRequest(new URLSearchParams("panel=comments&action=print&page=3"));

    expect(params.toString()).toBe("page=3");
  });
});

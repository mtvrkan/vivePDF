import { describe, expect, it } from "vitest";
import { scannerNotice } from "./scannerNotice";

describe("scannerNotice", () => {
  it("tells an unsupported system apart from a missing scanner", () => {
    expect(scannerNotice([], false)).toBe("unsupported");
    expect(scannerNotice([], true)).toBe("none");
  });

  it("asks for SANE when the system could scan but scanimage is missing", () => {
    expect(scannerNotice([], false, "saneMissing")).toBe("saneMissing");
    expect(scannerNotice(null, false, "saneMissing")).toBe("loading");
    expect(scannerNotice([], true, "saneMissing")).toBe("none");
  });

  it("tells a failing scanner service apart from an empty list", () => {
    expect(scannerNotice([], true, "deviceError")).toBe("deviceError");
    expect(scannerNotice([{ id: "wia-1", name: "Tarayıcı", feeder: false, flatbed: true, duplex: false }], true, "deviceError")).toBeNull();
  });

  it("waits while the device list loads and stays quiet once a scanner is found", () => {
    expect(scannerNotice(null, true)).toBe("loading");
    expect(scannerNotice([{ id: "wia-1", name: "Tarayıcı ş", feeder: false, flatbed: true, duplex: false }], true)).toBeNull();
  });
});

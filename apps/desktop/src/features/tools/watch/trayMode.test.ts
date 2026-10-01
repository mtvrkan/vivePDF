import { describe, expect, it } from "vitest";
import { trayWanted } from "./trayMode";

describe("trayWanted", () => {
  it("keeps the app in the tray while a watched folder is on where trays are reliable", () => {
    expect(trayWanted("auto", 1, true)).toBe(true);
    expect(trayWanted("auto", 0, true)).toBe(false);
  });

  it("never hides on its own on desktops without a reliable tray", () => {
    expect(trayWanted("auto", 3, false)).toBe(false);
    expect(trayWanted("always", 0, false)).toBe(true);
  });

  it("closes the app when the user turned the tray off", () => {
    expect(trayWanted("off", 2, true)).toBe(false);
  });
});

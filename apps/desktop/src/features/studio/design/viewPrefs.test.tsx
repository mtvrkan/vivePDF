import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMm } from "./units";
import { DEFAULT_VIEW_PREFS, readViewPrefs, STUDIO_VIEW_KEY, useViewPrefs } from "./viewPrefs";

describe("studio view preferences", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useViewPrefs.getState().reload();
  });

  it("remembers toggles for the next session", () => {
    useViewPrefs.getState().toggle("rulers");
    useViewPrefs.getState().toggle("bleed");

    expect(useViewPrefs.getState().rulers).toBe(false);
    expect(JSON.parse(localStorage.getItem(STUDIO_VIEW_KEY) ?? "{}")).toEqual({ ...DEFAULT_VIEW_PREFS, rulers: false, bleed: true });
    expect(readViewPrefs()).toMatchObject({ rulers: false, bleed: true, snap: true });
  });

  it("ignores unknown or damaged stored values", () => {
    localStorage.setItem(STUDIO_VIEW_KEY, JSON.stringify({ rulers: "no", guides: false, extra: true }));
    expect(readViewPrefs()).toEqual({ ...DEFAULT_VIEW_PREFS, guides: false });

    localStorage.setItem(STUDIO_VIEW_KEY, "{broken");
    expect(readViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });

  it("keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
    useViewPrefs.getState().toggle("snap");
    expect(useViewPrefs.getState().snap).toBe(false);
  });

  it("formats lengths in millimetres for the reader's language", () => {
    expect(formatMm(72, "en")).toBe("25.4");
    expect(formatMm(72, "tr")).toBe("25,4");
    expect(formatMm(1000, "en")).toBe("353");
    expect(formatMm(0, "en")).toBe("0");
  });
});

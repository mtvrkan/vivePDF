import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_SETTINGS, EXPORT_SETTINGS_KEY, normalizeExportSettings, readExportSettings, writeExportSettings } from "./exportSettings";

describe("export settings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("remembers the last used settings", () => {
    const settings = { format: "jpg" as const, dpi: 300, quality: 70, transparent: true, embed: false };

    writeExportSettings(settings);

    expect(readExportSettings()).toEqual(settings);
    expect(JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) ?? "{}")).toEqual(settings);
  });

  it("starts from the defaults and repairs values outside the limits", () => {
    expect(readExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(normalizeExportSettings({ format: "gif", dpi: 9000, quality: 5, transparent: "yes", embed: 1 })).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(normalizeExportSettings({ format: "png", dpi: 36.5, quality: 100 })).toEqual({ ...DEFAULT_EXPORT_SETTINGS, format: "png", quality: 100 });
  });

  it("survives broken or blocked storage", () => {
    localStorage.setItem(EXPORT_SETTINGS_KEY, "{not json");
    expect(readExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => writeExportSettings({ ...DEFAULT_EXPORT_SETTINGS, dpi: 72 })).not.toThrow();
    expect(readExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
  });
});

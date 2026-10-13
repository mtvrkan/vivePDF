import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_SETTINGS, DEFAULT_PRINT_SETTINGS, EXPORT_SETTINGS_KEY, normalizeExportSettings, normalizePrintSettings, readExportSettings, readPrintSettings, usePrintBleedStore, writeExportSettings, writePrintSettings } from "./exportSettings";

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

  it("remembers print settings and repairs bleed and plate choices", () => {
    writePrintSettings({ enabled: true, bleedMm: 5, marks: false, plates: "pages", sheet: "sra3" });

    expect(readPrintSettings()).toEqual({ enabled: true, bleedMm: 5, marks: false, plates: "pages", sheet: "sra3" });
    expect(normalizePrintSettings({ bleedMm: 42, plates: "glitter", marks: "yes", sheet: "a0" })).toEqual({ ...DEFAULT_PRINT_SETTINGS, bleedMm: 10 });
    expect(normalizePrintSettings({ bleedMm: 2.3 }).bleedMm).toBe(2.5);
  });

  it("hands the saved bleed to the canvas bleed guide", () => {
    writePrintSettings({ ...DEFAULT_PRINT_SETTINGS, bleedMm: 42 });

    expect(usePrintBleedStore.getState().bleedMm).toBe(10);

    writePrintSettings({ ...DEFAULT_PRINT_SETTINGS, bleedMm: 0 });

    expect(usePrintBleedStore.getState().bleedMm).toBe(0);
  });
});

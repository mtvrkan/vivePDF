import { beforeEach, describe, expect, it, vi } from "vitest";

const editorFont = vi.fn();
const fontFile = vi.fn();
vi.mock("@/shared/rpc/operations", () => ({ editorFont: (...args: unknown[]) => editorFont(...args), fontFile: (...args: unknown[]) => fontFile(...args) }));

import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { blockFontXrefs, bundledFontFamily, clearEmbeddedFontCache, fontFaceRules, fontFileKey, fontSourceVersion, loadBlockFonts, loadBundledFontSources, loadEmbeddedFont, loadFontFile } from "./embeddedFonts";
import { familyOfFontName, fontStackForRun } from "./pending";

const block = {
  fontXref: 12,
  fontExt: "ttf",
  textLines: [
    { runs: [{ fontXref: 12 }, { fontXref: 30 }] },
    { runs: [{ fontXref: 0 }, { fontXref: 30 }, { fontXref: 41 }] },
  ],
};

describe("blockFontXrefs", () => {
  it("lists the dominant font and every other run font once", () => {
    expect(blockFontXrefs(block)).toEqual([12, 30, 41]);
  });

  it("skips runs without an embedded font", () => {
    expect(blockFontXrefs({ fontXref: 0, textLines: [{ runs: [{ fontXref: 0 }] }] })).toEqual([]);
  });
});

describe("loadBlockFonts", () => {
  beforeEach(() => {
    editorFont.mockReset();
    editorFont.mockRejectedValue(new Error("not embedded"));
  });

  it("asks the sidecar for every run font, not only the dominant one", async () => {
    loadBlockFonts({ id: "doc-a", path: "a.pdf", password: null }, block);
    await Promise.resolve();
    expect(editorFont.mock.calls.map((call) => (call[0] as { xref: number }).xref)).toEqual([12, 30, 41]);
  });

  it("does not fetch a dominant font whose known type cannot be loaded by the webview", async () => {
    const result = await loadEmbeddedFont({ id: "doc-b", path: "b.pdf", password: null }, 7, "pfb");
    expect(result).toBeNull();
    expect(editorFont).not.toHaveBeenCalled();
  });

  it("drops a run font the sidecar reports in a format the webview cannot load", async () => {
    editorFont.mockResolvedValue({ name: "Type1", ext: "pfb", base64: "" });
    const result = await loadEmbeddedFont({ id: "doc-c", path: "c.pdf", password: null }, 9, null);
    expect(result).toBeNull();
  });
});

describe("fontStackForRun", () => {
  it("uses the loaded webfont of a non-dominant run", () => {
    const stack = fontStackForRun("Symbol", 30, 12, "Body", { "doc:30": "vp-embedded-30-doc" }, "doc", "abc");
    expect(stack.startsWith('"vp-embedded-30-doc"')).toBe(true);
    expect(stack).not.toContain('"Body"');
  });

  it("falls back to the installed family named by a non-dominant run font", () => {
    const stack = fontStackForRun("BCDEEE+Calibri", 33, 25, "Calibri", {}, "doc", "abc");
    expect(stack.startsWith('"Calibri"')).toBe(true);
  });

  it("strips the style suffix from a non-dominant run font name", () => {
    expect(familyOfFontName("Georgia-BoldItalic")).toBe("Georgia");
    expect(familyOfFontName("Verdana,Bold")).toBe("Verdana");
    expect(familyOfFontName(null)).toBe("");
  });

  it("keeps the dominant family for the dominant run", () => {
    const stack = fontStackForRun("Body", 12, 12, "Body", { "doc:12": "vp-embedded-12-doc" }, "doc", "abc");
    expect(stack.startsWith('"vp-embedded-12-doc", "Body"')).toBe(true);
  });
});

describe("loadFontFile", () => {
  const added: unknown[] = [];

  beforeEach(() => {
    fontFile.mockReset();
    added.length = 0;
    class FakeFontFace {
      family: string;
      constructor(family: string) {
        this.family = family;
      }
      load() {
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace);
    vi.stubGlobal("window", { atob: (value: string) => Buffer.from(value, "base64").toString("binary"), document: { fonts: { add: (face: unknown) => added.push(face) } } });
    useViewerOverlayStore.setState({ fontFamilies: {} });
  });

  it("registers the chosen catalogue font as a webview font face", async () => {
    fontFile.mockResolvedValue({ name: "Arial", ext: "ttf", base64: "AAEAAA==" });
    const family = await loadFontFile("system:arial", false);
    expect(family).toMatch(/^vp-font-/);
    expect(added).toHaveLength(1);
    expect(useViewerOverlayStore.getState().fontFamilies[fontFileKey("system:arial", false)]).toBe(family);
    expect(fontFile).toHaveBeenCalledWith({ id: "system:arial", bold: false });
  });

  it("fetches the file once and restores the family after the overlay store was cleared", async () => {
    fontFile.mockResolvedValue({ name: "Arial", ext: "ttf", base64: "AAEAAA==" });
    const first = await loadFontFile("system:arial-once", true);
    useViewerOverlayStore.setState({ fontFamilies: {} });
    const second = await loadFontFile("system:arial-once", true);
    expect(second).toBe(first);
    expect(fontFile).toHaveBeenCalledTimes(1);
    expect(useViewerOverlayStore.getState().fontFamilies[fontFileKey("system:arial-once", true)]).toBe(first);
  });

  it("skips collections the webview cannot load", async () => {
    fontFile.mockResolvedValue({ name: "MS Gothic", ext: "ttc", base64: "AAEAAA==" });
    expect(await loadFontFile("file:C:/Windows/Fonts/msgothic.ttc", false)).toBeNull();
    expect(added).toHaveLength(0);
  });

  it("keys bold and regular faces apart", () => {
    expect(fontFileKey("system:arial", true)).not.toBe(fontFileKey("system:arial", false));
  });
});

describe("loadEmbeddedFont", () => {
  const added: unknown[] = [];
  const removed: unknown[] = [];
  let rejectLoad = false;

  beforeEach(() => {
    editorFont.mockReset();
    added.length = 0;
    removed.length = 0;
    rejectLoad = false;
    class FakeFontFace {
      family: string;
      bytes: Uint8Array;
      constructor(family: string, bytes: Uint8Array) {
        this.family = family;
        this.bytes = bytes;
      }
      load() {
        return rejectLoad ? Promise.reject(new Error("Invalid font data in ArrayBuffer.")) : Promise.resolve(this);
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace);
    vi.stubGlobal("window", { atob: (value: string) => Buffer.from(value, "base64").toString("binary"), document: { fonts: { add: (face: unknown) => added.push(face), delete: (face: unknown) => removed.push(face) } } });
    useViewerOverlayStore.setState({ fontFamilies: {} });
  });

  it("re-applies the family on a cache hit after the overlay store was cleared", async () => {
    editorFont.mockResolvedValue({ name: "BCDEEE+Calibri", ext: "ttf", base64: "AAEAAA==" });
    const source = { id: "doc-reenter", path: "e.pdf", password: null };
    const first = await loadEmbeddedFont(source, 9, "ttf");
    useViewerOverlayStore.setState({ fontFamilies: {} });
    const second = await loadEmbeddedFont(source, 9, "ttf");
    expect(second).toBe(first);
    expect(editorFont).toHaveBeenCalledTimes(1);
    expect(useViewerOverlayStore.getState().fontFamilies["doc-reenter:9"]).toBe(first);
  });

  it("removes the document's font faces from the webview when the cache is cleared", async () => {
    editorFont.mockResolvedValue({ name: "BCDEEE+Calibri", ext: "ttf", base64: "AAEAAA==" });
    await loadEmbeddedFont({ id: "doc-faces", path: "f.pdf", password: null }, 3, "ttf");
    clearEmbeddedFontCache("doc-faces");
    expect(removed).toEqual(added);
    expect(removed).toHaveLength(1);
  });

  it("registers the subset program the sidecar repaired as the run's webfont", async () => {
    editorFont.mockResolvedValue({ name: "BCDEEE+Calibri", ext: "ttf", base64: "AAEAAA==" });
    const family = await loadEmbeddedFont({ id: "doc-repaired", path: "r.pdf", password: null }, 161, "ttf");
    expect(family).toBe("vp-embedded-161-doc-repa");
    expect(added).toHaveLength(1);
    expect(Array.from((added[0] as { bytes: Uint8Array }).bytes)).toEqual([0, 1, 0, 0]);
    expect(useViewerOverlayStore.getState().fontFamilies["doc-repaired:161"]).toBe(family);
  });

  it("falls back to installed families when the webview still rejects the program", async () => {
    rejectLoad = true;
    editorFont.mockResolvedValue({ name: "BCDEEE+Calibri", ext: "ttf", base64: "AAEAAA==" });
    expect(await loadEmbeddedFont({ id: "doc-rejected", path: "x.pdf", password: null }, 5, "ttf")).toBeNull();
    expect(added).toHaveLength(0);
    expect(useViewerOverlayStore.getState().fontFamilies["doc-rejected:5"]).toBeUndefined();
  });

  it("keeps the font program so lens snapshots can embed it, until the document closes", async () => {
    editorFont.mockResolvedValue({ name: "BCDEEE+Calibri", ext: "ttf", base64: "AAEAAA==" });
    const before = fontSourceVersion();
    const family = await loadEmbeddedFont({ id: "doc-lens", path: "l.pdf", password: null }, 44, "ttf");
    expect(fontSourceVersion()).toBe(before + 1);
    expect(fontFaceRules([family as string, family as string, "Arial"])).toBe(`@font-face{font-family:"${family}";src:url(data:font/ttf;base64,AAEAAA==)}`);
    clearEmbeddedFontCache("doc-lens");
    expect(fontFaceRules([family as string])).toBe("");
  });

  it("has no rule for a font the webview rejected", async () => {
    rejectLoad = true;
    editorFont.mockResolvedValue({ name: "BCDEEE+Calibri", ext: "ttf", base64: "AAEAAA==" });
    await loadEmbeddedFont({ id: "doc-lens-bad", path: "b.pdf", password: null }, 45, "ttf");
    expect(fontFaceRules(["vp-embedded-45-doc-lens"])).toBe("");
  });
});

describe("loadBundledFontSources", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { btoa: (value: string) => Buffer.from(value, "binary").toString("base64") });
  });

  it("retries after a failed fetch, then embeds both DejaVu weights once", async () => {
    const fetchFont = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchFont);
    expect(await loadBundledFontSources()).toBe(false);
    expect(fontFaceRules(["DejaVu Sans"])).toBe("");
    fetchFont.mockImplementation((url: string) => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array(url.includes("Bold") ? [2] : [1]).buffer) }));
    const before = fontSourceVersion();
    expect(await loadBundledFontSources()).toBe(true);
    expect(await loadBundledFontSources()).toBe(true);
    expect(fontSourceVersion()).toBe(before + 1);
    expect(fontFaceRules(["DejaVu Sans"])).toBe(
      '@font-face{font-family:"DejaVu Sans";font-weight:400;src:url(data:font/ttf;base64,AQ==)}@font-face{font-family:"DejaVu Sans";font-weight:700;src:url(data:font/ttf;base64,Ag==)}',
    );
    expect(fetchFont.mock.calls.map((call) => call[0])).toEqual(["/fonts/DejaVuSans.ttf", "/fonts/DejaVuSans-Bold.ttf", "/fonts/DejaVuSans.ttf", "/fonts/DejaVuSans-Bold.ttf"]);
  });

  it("knows which families ship with the app", () => {
    expect(bundledFontFamily("DejaVu Sans")).toBe(true);
    expect(bundledFontFamily("vp-font-abc")).toBe(false);
  });
});

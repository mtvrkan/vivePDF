import { describe, expect, it } from "vitest";
import { parseMode, parsePageSetting, parseSourceUrl, parseZoomSetting } from "./parse";

describe("parseZoomSetting", () => {
  it("reads fit modes and percentages with or without a percent sign", () => {
    const zooms = ["fit-width", " Fit-Page ", "150", "75%", "112.5", 200].map(parseZoomSetting);

    expect(zooms).toEqual(["fit-width", "fit-page", 150, 75, 112.5, 200]);
  });

  it("keeps a percentage inside the zoom range", () => {
    const zooms = ["5", "5000", 0].map(parseZoomSetting);

    expect(zooms).toEqual([10, 800, 10]);
  });

  it("ignores anything else", () => {
    const zooms = [null, undefined, "", "auto", "1.5x", "-20", Number.NaN].map(parseZoomSetting);

    expect(zooms).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("parsePageSetting", () => {
  it("reads a page number from an attribute or a number", () => {
    const pages = ["3", " 12 ", 7].map(parsePageSetting);

    expect(pages).toEqual([3, 12, 7]);
  });

  it("refuses zero, negatives, fractions and words", () => {
    const pages = ["0", "-2", "2.5", 2.5, "two", "", null].map(parsePageSetting);

    expect(pages).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("parseMode", () => {
  it("reads the four modes in any case", () => {
    const modes = ["inline", " FULL ", "Lightbox", "sized"].map(parseMode);

    expect(modes).toEqual(["inline", "full", "lightbox", "sized"]);
  });

  it("falls back to a sized box when the attribute is missing or unknown", () => {
    const modes = [null, "", "modal"].map(parseMode);

    expect(modes).toEqual(["sized", "sized", "sized"]);
  });
});

describe("parseSourceUrl", () => {
  const BASE = "https://site.test/docs/page.html";

  it("resolves web and blob addresses against the page", () => {
    const urls = ["files/a.pdf", "/b.pdf", "https://cdn.test/c.pdf", "http://old.test/d.pdf", "blob:https://site.test/1234"].map((url) => parseSourceUrl(url, BASE));

    expect(urls).toEqual(["https://site.test/docs/files/a.pdf", "https://site.test/b.pdf", "https://cdn.test/c.pdf", "http://old.test/d.pdf", "blob:https://site.test/1234"]);
  });

  it("refuses script, data and file addresses", () => {
    const urls = ["javascript:alert(1)", " JavaScript:alert(1)", "data:application/pdf;base64,JVBERi0=", "file:///etc/passwd"].map((url) => parseSourceUrl(url, BASE));

    expect(urls).toEqual([null, null, null, null]);
  });

  it("refuses addresses that hide their host behind a user name", () => {
    const url = parseSourceUrl("https://bank.test@evil.test/statement.pdf", BASE);

    expect(url).toBeNull();
  });
});

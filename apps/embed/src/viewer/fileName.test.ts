import { describe, expect, it } from "vitest";
import { downloadName } from "./fileName";

describe("downloadName", () => {
  it("takes the decoded last part of the address", () => {
    const name = downloadName("https://example.com/files/Y%C4%B1ll%C4%B1k%20rapor.pdf?v=2", null);

    expect(name).toBe("Yıllık rapor.pdf");
  });

  it("prefers the name the site gives and adds the extension when it is missing", () => {
    const names = [downloadName("https://example.com/get?id=7", "Price list"), downloadName("https://example.com/a.pdf", "  report.PDF ")];

    expect(names).toEqual(["Price list.pdf", "report.PDF"]);
  });

  it("falls back to a plain name and strips characters a file system refuses", () => {
    const names = [downloadName("https://example.com/", null), downloadName("not a url", null), downloadName("https://example.com/%E0%A4%A", null), downloadName("https://example.com/x", '..\\a/b:c*?"<>|')];

    expect(names).toEqual(["document.pdf", "document.pdf", "document.pdf", "a_b_c_.pdf"]);
  });

  it("drops invisible direction and zero-width characters that could disguise the name", () => {
    const name = downloadName("https://example.com/x", "invoice\u202Etxt.exe\u200B");

    expect(name).toBe("invoicetxt.exe.pdf");
  });
});

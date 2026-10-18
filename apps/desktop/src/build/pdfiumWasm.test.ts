import { describe, expect, it } from "vitest";
import { hashedPdfiumCopies, pointAtPublicPdfium } from "./pdfiumWasm";

describe("pointAtPublicPdfium", () => {
  it("points the package's own wasm URL at the public copy the app loads", () => {
    const code = 'return p ? "pdfium.wasm" : new URL("pdfium.wasm", import.meta.url).href; new URL(\'pdfium.wasm\',import.meta.url)';

    const pointed = pointAtPublicPdfium(code);

    expect(pointed).toBe('return p ? "pdfium.wasm" : new URL("/pdfium.wasm", self.location.origin).href; new URL("/pdfium.wasm", self.location.origin)');
  });

  it("leaves a module without the wasm URL alone", () => {
    expect(pointAtPublicPdfium('const name = "pdfium.wasm"; new URL("other.wasm", import.meta.url);')).toBeNull();
  });
});

describe("hashedPdfiumCopies", () => {
  it("names a second, hashed pdfium.wasm in the bundle and nothing else", () => {
    expect(hashedPdfiumCopies(["assets/pdfium-BJ2Yip8Q.wasm", "pdfium.wasm", "assets/index-abc.js", "assets/other-1.wasm"])).toEqual(["assets/pdfium-BJ2Yip8Q.wasm"]);
  });
});

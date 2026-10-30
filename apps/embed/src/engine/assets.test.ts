import { describe, expect, it } from "vitest";
import { assetUrl, setAssetBase, workerSource } from "./assets";

describe("workerSource", () => {
  it("starts a same-origin worker straight from its file", () => {
    const url = "https://example.com/static/vivepdf/engine-worker.js";

    const source = workerSource(url, "https://example.com");

    expect(source).toEqual({ kind: "direct", url });
  });

  it("wraps a CDN worker in a module stub that imports it", () => {
    const url = "https://cdn.jsdelivr.net/npm/@vivepdf/viewer@0.1.0/dist/engine-worker.js";

    const source = workerSource(url, "https://example.com");

    expect(source).toEqual({ kind: "stub", code: `import "${url}";` });
  });

  it("keeps a quote in the worker address inside the import string", () => {
    const url = 'https://cdn.example.net/a"b/engine-worker.js';

    const source = workerSource(url, "https://example.com");

    expect(source.kind === "stub" && source.code).toBe('import "https://cdn.example.net/a\\"b/engine-worker.js";');
  });
});

describe("assetUrl", () => {
  it("resolves files next to the loader", () => {
    setAssetBase("https://cdn.example.net/vivepdf/0.1.0/");

    const url = assetUrl("pdfium.wasm");

    expect(url).toBe("https://cdn.example.net/vivepdf/0.1.0/pdfium.wasm");
  });

  it("throws before the asset base is known", () => {
    setAssetBase("");

    const resolve = () => assetUrl("pdfium.wasm");

    expect(resolve).toThrow();
  });
});

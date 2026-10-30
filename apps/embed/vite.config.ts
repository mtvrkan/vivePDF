import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import { extractWorkers } from "./build/extractWorkers";

const require = createRequire(import.meta.url);
const WORKER_MARKERS = ["FPDF_LoadMemDocument", "rgbaToBmpBlob"];
const ASSETS_MODULE = fileURLToPath(new URL("./src/engine/assets.ts", import.meta.url));
const ENGINE_RANGE_MODULE = fileURLToPath(new URL("./src/engine/rangeReader.ts", import.meta.url));
const PDFIUM_WASM = require.resolve("@embedpdf/pdfium/pdfium.wasm");

function pdfiumWasmAsset(): Plugin {
  return {
    name: "vivepdf-embed-pdfium-wasm",
    apply: "build",
    generateBundle(_options, bundle) {
      const inlined = Object.entries(bundle).filter(([name, item]) => name.endsWith(".wasm") || (item.type === "chunk" && item.code.includes("data:application/wasm")));
      if (inlined.length > 0) this.error(`pdfium.wasm is bundled by the package itself (${inlined.map(([name]) => name).join(", ")}); the viewer fetches its own copy`);
      const blobs = Object.entries(bundle).filter(([, item]) => item.type === "chunk" && WORKER_MARKERS.some((marker) => item.code.includes(marker)));
      if (blobs.length > 0) this.error(`a worker is still built from a blob string in ${blobs.map(([name]) => name).join(", ")}`);
      this.emitFile({ type: "asset", fileName: "pdfium.wasm", source: readFileSync(PDFIUM_WASM) });
    },
  };
}

function minifyOutput(): Plugin {
  return {
    name: "vivepdf-embed-minify-output",
    apply: "build",
    async renderChunk(code, chunk, options) {
      const minified = await transformWithEsbuild(code, chunk.fileName, { minify: true, format: options.format === "es" ? "esm" : undefined, target: "es2022", legalComments: "none" });
      if (options.format === "iife" && !/^var VivePDF=\(function\(/.test(minified.code)) this.error(`${chunk.fileName} declares more than the VivePDF global`);
      return { code: minified.code, map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const esbuild = { jsx: "automatic", jsxImportSource: "preact", legalComments: "none" } as const;
  if (mode === "loader") {
    return {
      esbuild,
      plugins: [minifyOutput()],
      build: {
        target: "es2022",
        emptyOutDir: false,
        lib: { entry: "src/loader/index.ts", name: "VivePDF", formats: ["es", "iife"], fileName: (format) => (format === "es" ? "vivepdf.mjs" : "vivepdf.js") },
        sourcemap: false,
      },
    };
  }
  return {
    esbuild,
    define: { __ENGINE_BUILD__: JSON.stringify(createHash("sha256").update(readFileSync(PDFIUM_WASM)).digest("hex").slice(0, 16)) },
    plugins: [extractWorkers(ASSETS_MODULE, ENGINE_RANGE_MODULE), pdfiumWasmAsset(), minifyOutput()],
    build: {
      target: "es2022",
      lib: { entry: { viewer: "src/viewer/mount.tsx" }, formats: ["es"], fileName: (_format, name) => `${name}.js` },
      rollupOptions: { output: { chunkFileNames: "chunks/[name]-[hash].js" } },
      assetsInlineLimit: 0,
      sourcemap: false,
    },
  };
});

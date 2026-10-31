import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { minify } from "terser";
import { defineConfig, type Plugin } from "vite";
import { extractWorkers } from "./build/extractWorkers";

const require = createRequire(import.meta.url);
const WORKER_MARKERS = ["FPDF_LoadMemDocument", "rgbaToBmpBlob"];
const ASSETS_MODULE = fileURLToPath(new URL("./src/engine/assets.ts", import.meta.url));
const PDFIUM_WASM = require.resolve("@embedpdf/pdfium/pdfium.wasm");
const ENGINE_BUILD = createHash("sha256").update(readFileSync(PDFIUM_WASM)).digest("hex").slice(0, 16);
const ENGINE_PRELUDE = {
  modules: [
    { file: fileURLToPath(new URL("./src/engine/rangeReader.ts", import.meta.url)), global: "VivePdfRange" },
    { file: fileURLToPath(new URL("./src/engine/engineCache.ts", import.meta.url)), global: "VivePdfEngineCache" },
  ],
  setup: `VivePdfEngineCache.installEngineCache(self, ${JSON.stringify(ENGINE_BUILD)});`,
};

function pdfiumWasmAsset(): Plugin {
  return {
    name: "vivepdf-embed-pdfium-wasm",
    apply: "build",
    enforce: "post",
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
    enforce: "post",
    async generateBundle(options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        const minified = await minify(chunk.code, { module: options.format === "es", ecma: 2020, compress: { passes: 2 }, mangle: true, format: { comments: false } });
        const output = minified.code ?? "";
        if (!output) this.error(`${chunk.fileName} came out of the minifier empty`);
        if (options.format === "iife" && !/^var VivePDF=\(?function\(/.test(output)) this.error(`${chunk.fileName} declares more than the VivePDF global`);
        chunk.code = output;
      }
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
        minify: false,
      },
    };
  }
  return {
    esbuild,
    plugins: [extractWorkers(ASSETS_MODULE, ENGINE_PRELUDE), minifyOutput(), pdfiumWasmAsset()],
    build: {
      target: "es2022",
      lib: { entry: { viewer: "src/viewer/mount.tsx" }, formats: ["es"], fileName: (_format, name) => `${name}.js` },
      rollupOptions: { output: { chunkFileNames: "chunks/[name]-[hash].js" } },
      assetsInlineLimit: 0,
      sourcemap: false,
      minify: false,
    },
  };
});

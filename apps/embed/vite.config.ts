import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);

function pdfiumWasmAsset(): Plugin {
  return {
    name: "vivepdf-embed-pdfium-wasm",
    generateBundle(_options, bundle) {
      const inlined = Object.entries(bundle).filter(([name, item]) => name.endsWith(".wasm") || (item.type === "chunk" && item.code.includes("data:application/wasm")));
      if (inlined.length > 0) this.error(`pdfium.wasm is bundled by the package itself (${inlined.map(([name]) => name).join(", ")}); the loader fetches its own copy`);
      this.emitFile({ type: "asset", fileName: "pdfium.wasm", source: readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")) });
    },
  };
}

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  plugins: [pdfiumWasmAsset()],
  build: {
    target: "es2022",
    lib: { entry: "src/loader/index.ts", formats: ["es"], fileName: () => "vivepdf.js" },
    rollupOptions: { output: { chunkFileNames: "chunks/[name]-[hash].js" } },
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});

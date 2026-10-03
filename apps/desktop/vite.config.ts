import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/src/locales/en/")) return "locale-en";
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@embedpdf/engines") || id.includes("@embedpdf/pdfium")) return "vendor-pdfium";
          if (id.includes("@embedpdf")) return "vendor-embedpdf";
          if (id.includes("tailwind-merge")) return "vendor-tailwind-merge";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (id.includes("react-router") || id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) return "vendor-react";
          if (id.includes("i18next")) return "vendor-i18n";
          if (id.includes("lucide-react")) return "vendor-icons";
          return undefined;
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    watch: { ignored: ["**/src-tauri/**"] },
  },
});

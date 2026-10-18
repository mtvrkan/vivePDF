import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import { inlineScriptHashes } from "./src/seo/inlineScripts.ts";

export default defineConfig({
  site: "https://vivepdf.com",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [mdx()],
  security: {
    csp: {
      directives: ["default-src 'self'", "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "manifest-src 'self'"],
      scriptDirective: { resources: ["'self'", "'wasm-unsafe-eval'"], hashes: inlineScriptHashes() },
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
    },
  },
  i18n: {
    locales: ["tr", "en"],
    defaultLocale: "tr",
    routing: { prefixDefaultLocale: false },
  },
});

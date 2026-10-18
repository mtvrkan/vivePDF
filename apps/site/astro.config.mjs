import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://vivepdf.com",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [mdx()],
  i18n: {
    locales: ["tr", "en"],
    defaultLocale: "tr",
    routing: { prefixDefaultLocale: false },
  },
});

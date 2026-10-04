import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { studioIcons } from "./studioIcons";

export default defineConfig({
  plugins: [studioIcons()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
});

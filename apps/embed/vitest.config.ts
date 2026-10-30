import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "build/**/*.test.ts"], environment: "node" },
});

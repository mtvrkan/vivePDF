import { defineConfig, devices } from "@playwright/test";

const PAGE_PORT = 4310;
const ASSET_PORT = 4311;
const withFirefox = process.platform === "win32" || process.env.E2E_FIREFOX === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./e2e/globalSetup.ts",
  use: { baseURL: `http://127.0.0.1:${PAGE_PORT}` },
  webServer: [PAGE_PORT, ASSET_PORT].map((port) => ({
    command: "node bench/serve.mjs",
    env: { PORT: String(port) },
    url: `http://127.0.0.1:${port}/__served`,
    reuseExistingServer: false,
  })),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "ipad", use: { ...devices["iPad Pro 11"] } },
    ...(withFirefox ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] } }] : []),
  ],
});

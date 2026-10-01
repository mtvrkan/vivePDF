import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const targetDir = join(appDir, "src-tauri", "target", "e2e");

const result = spawnSync(
  "pnpm",
  ["tauri", "build", "--debug", "--no-bundle", "--features", "e2e", "--config", "e2e/tauri.e2e.conf.json"],
  {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  },
);
process.exit(result.status ?? 1);

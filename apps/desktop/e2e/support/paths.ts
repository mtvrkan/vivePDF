import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const E2E_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const APP_DIR = resolve(E2E_DIR, "..");
export const SIDECAR_DIR = resolve(APP_DIR, "..", "..", "sidecar");
export const TARGET_DIR = join(APP_DIR, "src-tauri", "target", "e2e");
export const APP_BINARY = process.env.VIVEPDF_E2E_APP ?? join(TARGET_DIR, "debug", process.platform === "win32" ? "vivepdf.exe" : "vivepdf");
export const DRIVER_CACHE = join(APP_DIR, "node_modules", ".cache", "vivepdf-e2e");
export const RUN_ROOT = process.env.VIVEPDF_E2E_OUTPUT ?? join(tmpdir(), "vivepdf-e2e");
export const APP_IDENTIFIER = "com.vivepdf.desktop.e2e";

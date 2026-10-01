import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { DRIVER_CACHE } from "./paths.ts";

const WEBVIEW2_CLIENT = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
const REGISTRY_KEYS = [
  `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT}`,
  `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT}`,
  `HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT}`,
];

function system32(program: string): string {
  return join(process.env.SystemRoot ?? "C:\\Windows", "System32", program);
}

export function webView2Version(): string {
  for (const key of REGISTRY_KEYS) {
    try {
      const output = execFileSync(system32("reg.exe"), ["query", key, "/v", "pv"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const match = /pv\s+REG_SZ\s+([\d.]+)/.exec(output);
      if (match && match[1] !== "0.0.0.0") return match[1];
    } catch {
      continue;
    }
  }
  throw new Error("WebView2 runtime not found");
}

export async function ensureEdgeDriver(): Promise<string> {
  if (process.env.VIVEPDF_E2E_EDGEDRIVER) return process.env.VIVEPDF_E2E_EDGEDRIVER;
  const version = webView2Version();
  const directory = join(DRIVER_CACHE, `msedgedriver-${version}`);
  const driver = join(directory, "msedgedriver.exe");
  if (existsSync(driver)) return driver;
  mkdirSync(directory, { recursive: true });
  const archive = join(directory, "edgedriver_win64.zip");
  const response = await fetch(`https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`);
  if (!response.ok || !response.body) throw new Error(`msedgedriver ${version} download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(archive));
  execFileSync(system32("tar.exe"), ["-xf", archive, "-C", directory]);
  if (!existsSync(driver)) throw new Error(`msedgedriver.exe missing after extracting ${archive}`);
  return driver;
}

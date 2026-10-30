import { existsSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = ["dist/vivepdf.js", "dist/vivepdf.mjs", "dist/viewer.js", "dist/engine-worker.js", "dist/pdfium.wasm", "bench/fixtures/small.pdf", "bench/fixtures/book.pdf"];

export default function globalSetup(): void {
  const root = join(import.meta.dirname, "..");
  const missing = REQUIRED.filter((file) => !existsSync(join(root, file)));
  if (missing.length > 0) throw new Error(`missing ${missing.join(", ")} — run pnpm build and pnpm bench:fixtures first`);
}

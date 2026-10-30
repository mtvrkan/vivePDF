import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { build } from "vite";

const BUDGETS = { "vivepdf.js": 6 * 1024, viewer: 60 * 1024, "pdfium.wasm": 1.7 * 1024 * 1024 };
const showModules = process.argv.includes("--modules");

function brotli(bytes) {
  return brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
}

function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

function budgetOf(fileName) {
  if (fileName === "vivepdf.js" || fileName === "pdfium.wasm") return BUDGETS[fileName];
  return BUDGETS.viewer;
}

const result = await build({ root: process.cwd(), logLevel: "silent", build: { write: false } });
const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
let failed = false;
let viewerTotal = 0;
for (const item of outputs) {
  const bytes = item.type === "chunk" ? Buffer.from(item.code) : Buffer.from(item.source);
  const compressed = brotli(bytes);
  if (item.fileName.startsWith("chunks/")) viewerTotal += compressed;
  const budget = budgetOf(item.fileName);
  const over = !item.fileName.startsWith("chunks/") && compressed > budget;
  if (over) failed = true;
  console.log(`${item.fileName.padEnd(36)} raw ${kb(bytes.length).padStart(11)}  gzip ${kb(gzipSync(bytes, { level: 9 }).length).padStart(10)}  brotli ${kb(compressed).padStart(10)}${over ? `  OVER ${kb(budget)}` : ""}`);
  if (showModules && item.type === "chunk") {
    const rows = Object.entries(item.modules)
      .map(([id, info]) => [info.renderedLength, id.replace(/.*node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?/, "")])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 20);
    for (const [length, id] of rows) console.log(`    ${kb(length).padStart(10)}  ${id}`);
  }
}
const viewerOver = viewerTotal > BUDGETS.viewer;
if (viewerOver) failed = true;
console.log(`viewer chunks total brotli ${kb(viewerTotal)} (budget ${kb(BUDGETS.viewer)})${viewerOver ? " OVER" : ""}`);
process.exitCode = failed ? 1 : 0;

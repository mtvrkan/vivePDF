import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { build } from "vite";

const KB = 1024;
const GROUPS = [
  { name: "loader (vivepdf.js / vivepdf.mjs)", match: (file) => /^vivepdf\.m?js$/.test(file), budget: 6 * KB, each: true },
  { name: "viewer (viewer.js + chunks)", match: (file) => file === "viewer.js" || (file.startsWith("chunks/") && !file.startsWith("chunks/annotate-")), budget: 70 * KB },
  { name: "drawing tools (chunks/annotate)", match: (file) => file.startsWith("chunks/annotate-"), budget: 60 * KB },
  { name: "workers (engine + encoder)", match: (file) => file.endsWith("-worker.js"), budget: 70 * KB },
  { name: "engine (pdfium.wasm)", match: (file) => file === "pdfium.wasm", budget: 1.7 * KB * KB },
];
const NOT_DOWNLOADED = new Set(["THIRD-PARTY-NOTICES.txt"]);
const showModules = process.argv.includes("--modules");

function brotli(bytes) {
  return brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
}

function kb(n) {
  return `${(n / KB).toFixed(1)} KB`;
}

async function outputsOf(mode) {
  const result = await build({ root: process.cwd(), mode, logLevel: "silent", build: { write: false } });
  return (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
}

const outputs = [...(await outputsOf("viewer")), ...(await outputsOf("loader"))];
const rows = outputs.map((item) => {
  const bytes = item.type === "chunk" ? Buffer.from(item.code) : Buffer.from(item.source);
  return { item, file: item.fileName, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotli(bytes) };
});
for (const row of rows) {
  console.log(`${row.file.padEnd(36)} raw ${kb(row.raw).padStart(11)}  gzip ${kb(row.gzip).padStart(10)}  brotli ${kb(row.brotli).padStart(10)}`);
  if (showModules && row.item.type === "chunk") {
    const modules = Object.entries(row.item.modules)
      .map(([id, info]) => [info.renderedLength, id.replace(/.*node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?/, "")])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 20);
    for (const [length, id] of modules) console.log(`    ${kb(length).padStart(10)}  ${id}`);
  }
}
let failed = false;
console.log("");
for (const group of GROUPS) {
  const members = rows.filter((row) => group.match(row.file));
  if (members.length === 0) {
    failed = true;
    console.log(`${group.name}: MISSING`);
    continue;
  }
  const size = group.each ? Math.max(...members.map((row) => row.brotli)) : members.reduce((sum, row) => sum + row.brotli, 0);
  const over = size > group.budget;
  if (over) failed = true;
  console.log(`${group.name.padEnd(36)} brotli ${kb(size).padStart(10)} / budget ${kb(group.budget)}${over ? "  OVER" : "  ok"}`);
}
const unmatched = rows.filter((row) => !NOT_DOWNLOADED.has(row.file) && !GROUPS.some((group) => group.match(row.file)));
for (const row of unmatched) {
  failed = true;
  console.log(`unbudgeted output: ${row.file}`);
}
process.exitCode = failed ? 1 : 0;

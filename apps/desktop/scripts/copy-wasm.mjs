import { copyFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const entry = require.resolve("@embedpdf/pdfium");
const source = join(dirname(entry), "pdfium.wasm");
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(appDir, "public");
const target = join(publicDir, "pdfium.wasm");

function copyIfChanged(from, to) {
  if (existsSync(to) && statSync(to).size === statSync(from).size) return false;
  copyFileSync(from, to);
  return true;
}

function packageRoot(resolver, name) {
  let dir = dirname(resolver.resolve(name));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package root not found for ${name}`);
    dir = parent;
  }
  return dir;
}

mkdirSync(publicDir, { recursive: true });
if (copyIfChanged(source, target)) {
  console.log(`copied pdfium.wasm (${statSync(source).size} bytes)`);
}

const fallbackManifest = JSON.parse(
  readFileSync(join(appDir, "src", "features", "viewer", "pdf", "fallbackFonts.json"), "utf8"),
);
const fontsResolver = createRequire(require.resolve("@embedpdf/engines"));
const fontsTarget = join(publicDir, ...fallbackManifest.directory.split("/"));
mkdirSync(fontsTarget, { recursive: true });
let copiedFonts = 0;
const wantedFonts = new Set();
for (const set of fallbackManifest.sets.filter((entry) => entry.bundled)) {
  const root = packageRoot(fontsResolver, set.package);
  const licenseName = `LICENSE-${set.package.split("/").pop()}.txt`;
  if (existsSync(join(root, "LICENSE"))) {
    copyIfChanged(join(root, "LICENSE"), join(fontsTarget, licenseName));
    wantedFonts.add(licenseName);
  }
  for (const { file } of set.files) {
    wantedFonts.add(file);
    if (copyIfChanged(join(root, "fonts", file), join(fontsTarget, file))) copiedFonts += 1;
  }
}
if (copiedFonts > 0) console.log(`copied ${copiedFonts} fallback fonts`);
const staleFonts = readdirSync(fontsTarget).filter((name) => !wantedFonts.has(name));
for (const name of staleFonts) rmSync(join(fontsTarget, name), { recursive: true, force: true });
if (staleFonts.length > 0) console.log(`removed ${staleFonts.length} stale fallback files`);

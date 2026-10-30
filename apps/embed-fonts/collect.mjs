import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const families = JSON.parse(readFileSync(join(here, "..", "embed", "src", "engine", "fallbackFonts.json"), "utf8"));
const out = join(here, "fonts");
mkdirSync(out, { recursive: true });

const licences = new Map();
let total = 0;
for (const family of families) {
  const root = join(here, "node_modules", ...family.package.split("/"));
  for (const [file] of family.files) {
    copyFileSync(join(root, "fonts", file), join(out, file));
    total += statSync(join(out, file)).size;
  }
  const licenceName = readdirSync(root).find((name) => /^(ofl|license)/i.test(name));
  if (!licenceName) throw new Error(`no OFL licence file in ${family.package}`);
  const text = readFileSync(join(root, licenceName), "utf8").trim();
  licences.set(text, [...(licences.get(text) ?? []), family.package]);
}
const sections = [...licences].map(([text, packages]) => `Fonts from ${packages.join(", ")}\n\n${text}`);
writeFileSync(join(here, "OFL.txt"), `${sections.join("\n\n----------------------------------------\n\n")}\n`);
console.log(`${families.reduce((count, family) => count + family.files.length, 0)} fonts, ${(total / 1_048_576).toFixed(1)} MB`);

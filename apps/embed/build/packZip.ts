import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { zipFiles, type ZipEntry } from "./zip.ts";

const root = new URL("..", import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const folder = `vivepdf-viewer-${version}`;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]))
    .sort();
}

const sources = [...filesUnder(join(root, "dist")), join(root, "LICENSE"), join(root, "THIRD-PARTY-NOTICES.txt"), join(root, "README.md"), join(root, "CHANGELOG.md"), ...filesUnder(join(root, "docs"))];
const entries: ZipEntry[] = sources.map((file) => ({ name: `${folder}/${relative(root, file).split(sep).join("/")}`, data: readFileSync(file) }));
const output = join(root, "release", `${folder}.zip`);
mkdirSync(join(root, "release"), { recursive: true });
writeFileSync(output, zipFiles(entries));
console.log(`${relative(root, output)}: ${entries.length} files`);

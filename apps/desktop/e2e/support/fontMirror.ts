import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { APP_DIR } from "./paths.ts";

type Manifest = { sets: { package: string; bundled: boolean; files: { file: string }[] }[] };

function packageRoot(resolver: NodeJS.Require, name: string): string {
  let dir = dirname(resolver.resolve(name));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package root not found for ${name}`);
    dir = parent;
  }
  return dir;
}

function downloadableFonts(): Map<string, string> {
  const manifest = JSON.parse(readFileSync(join(APP_DIR, "src", "features", "viewer", "pdf", "fallbackFonts.json"), "utf8")) as Manifest;
  const resolver = createRequire(createRequire(join(APP_DIR, "package.json")).resolve("@embedpdf/engines"));
  const fonts = new Map<string, string>();
  for (const set of manifest.sets.filter((entry) => !entry.bundled)) {
    const root = packageRoot(resolver, set.package);
    for (const { file } of set.files) fonts.set(file, join(root, "fonts", file));
  }
  return fonts;
}

export async function startFontMirror(): Promise<{ url: string; server: Server }> {
  const fonts = downloadableFonts();
  const server = createServer((request, response) => {
    const path = fonts.get(decodeURIComponent((request.url ?? "/").replace(/^\/+/, "").split("?")[0]));
    if (request.method !== "GET" || !path) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "font/otf", "Content-Length": statSync(path).size });
    createReadStream(path).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("font mirror has no port");
  return { url: `http://127.0.0.1:${address.port}`, server };
}

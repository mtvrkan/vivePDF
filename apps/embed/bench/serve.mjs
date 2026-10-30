import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");
const MOUNTS = { "/dist/": join(ROOT, "dist"), "/fixtures/": join(ROOT, "bench", "fixtures"), "/bench/": join(ROOT, "bench"), "/e2e/": join(ROOT, "e2e", "pages"), "/fonts/": join(ROOT, "..", "embed-fonts", "fonts") };
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html; charset=utf-8", ".pdf": "application/pdf", ".otf": "font/otf", ".ttf": "font/ttf" };
const COMPRESSIBLE = new Set([".js", ".mjs", ".wasm", ".html"]);
const brotliCache = new Map();
const served = new Map();

function resolvePath(urlPath) {
  for (const [prefix, base] of Object.entries(MOUNTS)) {
    if (!urlPath.startsWith(prefix)) continue;
    const target = normalize(join(base, decodeURIComponent(urlPath.slice(prefix.length))));
    if (target !== base && !target.startsWith(base + sep)) return null;
    return existsSync(target) && statSync(target).isFile() ? target : null;
  }
  return null;
}

function brotliOf(path) {
  const stamp = statSync(path).mtimeMs;
  const cached = brotliCache.get(path);
  if (cached && cached.stamp === stamp) return cached.bytes;
  const bytes = brotliCompressSync(readFileSync(path), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  brotliCache.set(path, { stamp, bytes });
  return bytes;
}

function count(urlPath, bytes) {
  served.set(urlPath, (served.get(urlPath) ?? 0) + bytes);
}

function precompress(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) precompress(path);
    else if (COMPRESSIBLE.has(extname(path))) brotliOf(path);
  }
}

export function startServer(port = 0) {
  if (existsSync(MOUNTS["/dist/"])) precompress(MOUNTS["/dist/"]);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/__served") {
      const body = JSON.stringify(Object.fromEntries(served));
      if (url.searchParams.has("reset")) served.clear();
      response.writeHead(200, { "content-type": "application/json" }).end(body);
      return;
    }
    const path = resolvePath(url.pathname);
    if (!path) {
      response.writeHead(404).end();
      return;
    }
    const type = TYPES[extname(path)] ?? "application/octet-stream";
    const headers = {
      "content-type": type,
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "accept-ranges, content-range, content-length",
      "cache-control": url.pathname.startsWith("/dist/") ? "public, max-age=31536000, immutable" : "no-store",
    };
    const size = statSync(path).size;
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (extname(path) === ".pdf") headers["accept-ranges"] = "bytes";
    if (range && extname(path) === ".pdf") {
      const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      const end = range[1] !== "" && range[2] !== "" ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        response.writeHead(416, { "content-range": `bytes */${size}` }).end();
        return;
      }
      response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      count(url.pathname, end - start + 1);
      if (request.method === "HEAD") response.end();
      else createReadStream(path, { start, end }).pipe(response);
      return;
    }
    if (COMPRESSIBLE.has(extname(path)) && /\bbr\b/.test(request.headers["accept-encoding"] ?? "")) {
      const bytes = brotliOf(path);
      response.writeHead(200, { ...headers, "content-encoding": "br", "content-length": bytes.length, vary: "accept-encoding" });
      count(url.pathname, bytes.length);
      response.end(request.method === "HEAD" ? undefined : bytes);
      return;
    }
    response.writeHead(200, { ...headers, "content-length": size });
    count(url.pathname, size);
    if (request.method === "HEAD") response.end();
    else createReadStream(path).pipe(response);
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

if (process.argv[1] === import.meta.filename) {
  const server = await startServer(Number(process.env.PORT ?? 4310));
  console.log(`bench server on http://127.0.0.1:${server.address().port}/bench/index.html?file=book.pdf`);
}

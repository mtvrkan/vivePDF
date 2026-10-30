import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright-core";
import { startServer } from "./serve.mjs";

const ENGINES = { chromium, webkit, firefox };
const FIXTURES = ["small.pdf", "book.pdf", "scan.pdf"];
const REPEATS = Number(process.env.REPEATS ?? 3);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 60_000);
const THROTTLE = { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 };

const argv = process.argv.slice(2);
const only = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1]?.split(",");
const engines = only("engines") ?? Object.keys(ENGINES);
const fixtures = only("files") ?? FIXTURES;
const loads = only("load") ?? ["range", "full"];
const throttled = argv.includes("--throttle");

function median(values) {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null;
}

async function served(origin, reset) {
  return (await fetch(`${origin}/__served${reset ? "?reset" : ""}`)).json();
}

async function measure(page, origin, file, load) {
  await served(origin, true);
  const errors = [];
  const onError = (error) => errors.push(error.stack ?? String(error));
  const onConsole = (message) => message.type() === "error" && errors.push(message.text());
  page.on("pageerror", onError);
  page.on("console", onConsole);
  const started = Date.now();
  await page.goto(`${origin}/bench/index.html?file=${file}&load=${load}`);
  const timedOut = await page
    .waitForFunction(() => window.__marks.some((mark) => ["first-page", "open-error", "engine-error"].includes(mark.name)), null, { timeout: TIMEOUT_MS, polling: 20 })
    .then(() => false, () => true);
  const marks = Object.fromEntries((await page.evaluate(() => window.__marks)).map((mark) => [mark.name, mark.time]));
  const lastPage = await page.evaluate(async () => {
    const root = document.querySelector("vive-pdf")?.shadowRoot;
    const scroller = [...(root?.querySelectorAll("div") ?? [])].find((node) => node.scrollHeight > node.clientHeight + 10 && getComputedStyle(node).overflowY !== "visible");
    const pages = root?.querySelectorAll("[data-page-index]") ?? [];
    if (!scroller || pages.length === 0) return null;
    const start = performance.now();
    scroller.scrollTop = scroller.scrollHeight;
    return new Promise((done) => {
      const deadline = start + 30_000;
      const tick = () => {
        const nodes = [...root.querySelectorAll("[data-page-index]")];
        const last = nodes.reduce((best, node) => (Number(node.dataset.pageIndex) > Number(best?.dataset.pageIndex ?? -1) ? node : best), null);
        const image = last?.querySelector("img");
        if (image && image.complete && image.naturalWidth > 0) done(performance.now() - start);
        else if (performance.now() > deadline) done(null);
        else requestAnimationFrame(tick);
      };
      tick();
    });
  });
  const bytes = await served(origin, false);
  page.off("pageerror", onError);
  page.off("console", onConsole);
  return {
    wallMs: Date.now() - started,
    viewerLoaded: marks["viewer-loaded"] ?? null,
    engineReady: marks["engine-ready"] ?? null,
    documentOpen: marks["document-open"] ?? null,
    firstPage: marks["first-page"] ?? null,
    lastPageAfterJump: lastPage,
    failed: timedOut || marks["open-error"] !== undefined || marks["engine-error"] !== undefined,
    reached: Object.keys(marks),
    pdfBytes: bytes[`/fixtures/${file}`] ?? 0,
    assetBytes: Object.entries(bytes).filter(([path]) => path.startsWith("/dist/")).reduce((sum, [, n]) => sum + n, 0),
    errors,
  };
}

async function throttle(context, page) {
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", THROTTLE);
}

const resultsDir = join(import.meta.dirname, "results");
mkdirSync(resultsDir, { recursive: true });
const resultsFile = join(resultsDir, `bench-${new Date().toISOString().replace(/[:.]/g, "-")}${throttled ? "-throttled" : ""}.jsonl`);
const server = await startServer();
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const name of engines) {
    const browser = await ENGINES[name].launch({ headless: true }).catch((error) => {
      console.error(`${name} did not start: ${error.message.split("\n")[0]}`);
      return null;
    });
    if (!browser) continue;
    try {
      for (const file of fixtures) {
        for (const load of loads) {
          const runs = { cold: [], warm: [] };
          for (let repeat = 0; repeat < REPEATS; repeat += 1) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            const page = await context.newPage();
            if (throttled && name === "chromium") await throttle(context, page);
            runs.cold.push(await measure(page, origin, file, load));
            runs.warm.push(await measure(page, origin, file, load));
            await context.close();
          }
          for (const kind of ["cold", "warm"]) {
            const list = runs[kind];
            const row = {
              engine: name,
              file,
              load,
              cache: kind,
              throttled: throttled && name === "chromium",
              firstPageMs: median(list.map((run) => run.firstPage)),
              engineReadyMs: median(list.map((run) => run.engineReady)),
              documentOpenMs: median(list.map((run) => run.documentOpen)),
              lastPageAfterJumpMs: median(list.map((run) => run.lastPageAfterJump)),
              pdfKB: Math.round(median(list.map((run) => run.pdfBytes)) / 1024),
              assetKB: Math.round(median(list.map((run) => run.assetBytes)) / 1024),
              failed: list.filter((run) => run.failed).length,
              reached: list[0]?.reached ?? [],
              errors: [...new Set(list.flatMap((run) => run.errors))].slice(0, 3),
            };
            appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
            console.log(JSON.stringify(row));
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
console.log(`results: ${resultsFile}`);

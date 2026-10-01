import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { browser } from "@wdio/globals";
import { bootApp, closeAllDocuments, copyFixture, fixtures, openInViewer, workDir } from "../support/app.ts";
import { powershell } from "../support/desktop.ts";
import { APP_BINARY } from "../support/paths.ts";

const PERF_DIR = process.env.VIVEPDF_E2E_PERF_DIR;
const SOAK_CYCLES = Number(process.env.VIVEPDF_E2E_SOAK_CYCLES ?? 10);
const suite = PERF_DIR ? describe : describe.skip;

type ProcessMemory = { name: string; count: number; privateMb: number; workingMb: number };
type Report = {
  cores: string;
  startup: Record<string, number | null>;
  operations: Record<string, number>;
  soak: Array<{ cycle: number; heapMb: number | null; processes: ProcessMemory[] }>;
};

const report: Report = { cores: process.env.VIVEPDF_E2E_CORES ?? "all", startup: {}, operations: {}, soak: [] };

function processTree(): { startedAt: number; groups: ProcessMemory[] } {
  const script = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, PrivatePageCount, WorkingSetSize, CreationDate, ExecutablePath, CommandLine
$root = $all | Where-Object { $_.ExecutablePath -ieq '${resolve(APP_BINARY).replace(/'/g, "''")}' } | Sort-Object CreationDate -Descending | Select-Object -First 1
$tree = @($root); $queue = @($root.ProcessId)
while ($queue.Count -gt 0) { $parent = $queue[0]; $queue = @($queue | Select-Object -Skip 1); foreach ($child in ($all | Where-Object { $_.ParentProcessId -eq $parent })) { $tree += $child; $queue += $child.ProcessId } }
[pscustomobject]@{ startedAt = ([DateTimeOffset]$root.CreationDate).ToUnixTimeMilliseconds(); processes = @($tree | ForEach-Object { $kind = if ($_.CommandLine -match '--type=([a-z-]+)') { $Name = $_.Name + ':' + $Matches[1]; $Name } else { $_.Name }; [pscustomobject]@{ name = $kind; privateBytes = [double]$_.PrivatePageCount; workingBytes = [double]$_.WorkingSetSize } }) } | ConvertTo-Json -Depth 4 -Compress`;
  const parsed = JSON.parse(powershell(script)) as { startedAt: number; processes: Array<{ name: string; privateBytes: number; workingBytes: number }> };
  const groups = new Map<string, ProcessMemory>();
  for (const entry of parsed.processes) {
    const group = groups.get(entry.name) ?? { name: entry.name, count: 0, privateMb: 0, workingMb: 0 };
    group.count += 1;
    group.privateMb += entry.privateBytes / 1048576;
    group.workingMb += entry.workingBytes / 1048576;
    groups.set(entry.name, group);
  }
  return { startedAt: parsed.startedAt, groups: [...groups.values()].map((group) => ({ ...group, privateMb: Math.round(group.privateMb), workingMb: Math.round(group.workingMb) })) };
}

async function engineAnswers(): Promise<boolean> {
  return browser
    .executeAsync((done: (answered: boolean) => void) => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      if (!bridge) return done(false);
      bridge.invoke("rpc", { id: crypto.randomUUID(), method: "system.ping", params: {} }).then(
        () => done(true),
        () => done(false),
      );
    })
    .catch(() => false);
}

async function rpc(method: string, params: Record<string, unknown>): Promise<number> {
  const started = Date.now();
  const outcome = await browser.executeAsync(
    (name: string, body: Record<string, unknown>, done: (result: string) => void) => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      bridge.invoke("rpc", { id: crypto.randomUUID(), method: name, params: body }).then(
        () => done("ok"),
        (error: unknown) => done(`error: ${JSON.stringify(error)}`),
      );
    },
    method,
    params,
  );
  if (outcome !== "ok") throw new Error(`${method} failed: ${outcome}`);
  return Date.now() - started;
}

async function heapMegabytes(): Promise<number | null> {
  return browser.execute(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
  });
}

async function readThrough() {
  const pages = await browser.execute(() => {
    const page = document.querySelector<HTMLElement>("[data-page-index]");
    let scroller = page?.parentElement ?? null;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    return scroller ? Math.max(1, Math.floor(scroller.scrollHeight / scroller.clientHeight)) : 0;
  });
  const steps = Math.min(25, pages);
  for (let step = 1; step <= steps; step += 1) {
    await browser.execute((fraction: number) => {
      const page = document.querySelector<HTMLElement>("[data-page-index]");
      let scroller = page?.parentElement ?? null;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      if (scroller) scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * fraction;
    }, step / steps);
    await browser.pause(120);
  }
}

suite("performance", () => {
  before(async () => {
    browser.setTimeout({ script: 900000 });
    let engineAt: number | null = null;
    const deadline = Date.now() + 180000;
    while (engineAt === null && Date.now() < deadline) {
      if (await engineAnswers()) engineAt = Date.now();
      else await browser.pause(50);
    }
    const page = await browser.execute(() => {
      const ready = performance.getEntriesByName("vivepdf:ready")[0];
      const paint = performance.getEntriesByName("first-contentful-paint")[0];
      return { origin: performance.timeOrigin, ready: ready ? ready.startTime : null, paint: paint ? paint.startTime : null };
    });
    const { startedAt } = processTree();
    report.startup = {
      processToWebViewMs: Math.round(page.origin - startedAt),
      processToFirstPaintMs: page.paint === null ? null : Math.round(page.origin + page.paint - startedAt),
      processToUiReadyMs: page.ready === null ? null : Math.round(page.origin + page.ready - startedAt),
      processToEngineMs: engineAt === null ? null : Math.round(engineAt - startedAt),
    };
    await bootApp();
    const reloaded = Date.now();
    await browser.refresh();
    await browser.waitUntil(async () => browser.execute(() => performance.getEntriesByName("vivepdf:ready").length > 0), { timeout: 60000, interval: 20 });
    report.startup.reloadToUiReadyMs = Date.now() - reloaded;
  });

  after(() => {
    writeFileSync(join(workDir(), "perf.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  });

  it("times engine operations on large documents", async function () {
    const thesis = join(PERF_DIR as string, "tez-800-sayfa.pdf");
    const scan = join(PERF_DIR as string, "taranmis-kitap.pdf");
    if (!existsSync(thesis) || !existsSync(scan)) this.skip();
    const out = (name: string) => join(workDir(), name);
    report.operations.compressThesisMs = await rpc("compress.run", { path: thesis, output: out("thesis-small.pdf"), overwrite: true });
    report.operations.docxThesis20PagesMs = await rpc("convert.to_docx", { path: thesis, output: out("thesis.docx"), overwrite: true, pages: "1-20" });
    report.operations.markdownThesis50PagesMs = await rpc("convert.to_markdown", { path: thesis, output: out("thesis.md"), overwrite: true, pages: "1-50" });
    report.operations.ocrScan5PagesMs = await rpc("ocr.run", { path: scan, output: out("scan-ocr.pdf"), overwrite: true, pages: "1-5", mode: "force" });
    report.operations.compressScanMs = await rpc("compress.run", { path: scan, output: out("scan-small.pdf"), overwrite: true });
  });

  it("keeps memory flat over repeated open, read and close cycles", async function () {
    const thesisSource = join(PERF_DIR as string, "tez-800-sayfa.pdf");
    const scanSource = join(PERF_DIR as string, "taranmis-kitap.pdf");
    if (!existsSync(thesisSource) || !existsSync(scanSource)) this.skip();
    const documents = [copyFixture(thesisSource), ...(process.env.VIVEPDF_E2E_SOAK_SKIP_SCAN ? [] : [copyFixture(scanSource)]), copyFixture(fixtures().illustrated), copyFixture(fixtures().annotated), copyFixture(fixtures().academic)];
    const sample = async (cycle: number) => {
      await browser.pause(2000);
      report.soak.push({ cycle, heapMb: await heapMegabytes(), processes: processTree().groups });
    };
    await sample(0);
    for (let cycle = 1; cycle <= SOAK_CYCLES; cycle += 1) {
      for (const path of documents) {
        await openInViewer(path);
        await readThrough();
      }
      await closeAllDocuments();
      await sample(cycle);
    }
  });
});

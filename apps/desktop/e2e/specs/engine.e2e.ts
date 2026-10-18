import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { bootApp, copyFixture, fixtures, openInViewer, workDir } from "../support/app.ts";

type Bridge = { invoke: <T>(command: string, args: unknown) => Promise<T> };
type BusyWindow = Window & { __TAURI_INTERNALS__: Bridge; __busyJobs?: { ids: string[]; settled: number } };

const HEAVY_JOBS = 4;

describe("engine scheduling", () => {
  before(bootApp);

  it("answers a page thumbnail while OCR jobs keep every heavy worker busy", async () => {
    const path = copyFixture(fixtures().long, "busy-long.pdf");
    await openInViewer(path);
    const outputs = Array.from({ length: HEAVY_JOBS }, (_, index) => join(workDir(), `busy-ocr-${index}.pdf`));

    await browser.execute(
      (source: string, targets: string[]) => {
        const busy = window as unknown as BusyWindow;
        const jobs = { ids: targets.map(() => crypto.randomUUID()), settled: 0 };
        busy.__busyJobs = jobs;
        targets.forEach((output, index) => {
          const settle = () => {
            jobs.settled += 1;
          };
          busy.__TAURI_INTERNALS__.invoke("rpc", { id: jobs.ids[index], method: "ocr.run", params: { path: source, output, mode: "force", languages: ["eng"] } }).then(settle, settle);
        });
      },
      path,
      outputs,
    );
    await browser.pause(3000);

    const answer = await browser.executeAsync((source: string, done: (result: { ms: number; ok: boolean; settled: number }) => void) => {
      const busy = window as unknown as BusyWindow;
      const started = performance.now();
      busy.__TAURI_INTERNALS__.invoke<{ image?: string }>("rpc", { id: crypto.randomUUID(), method: "info.thumbnail", params: { path: source, page: 200, width: 160, format: "jpeg" } }).then(
        (result) => done({ ms: performance.now() - started, ok: typeof result.image === "string" && result.image.length > 0, settled: busy.__busyJobs?.settled ?? -1 }),
        () => done({ ms: performance.now() - started, ok: false, settled: busy.__busyJobs?.settled ?? -1 }),
      );
    }, path);

    await browser.executeAsync((done: () => void) => {
      const busy = window as unknown as BusyWindow;
      const ids = busy.__busyJobs?.ids ?? [];
      Promise.all(ids.map((target) => busy.__TAURI_INTERNALS__.invoke("rpc_cancel", { target }).catch(() => undefined))).then(() => done());
    });
    await browser.waitUntil(async () => (await browser.execute(() => (window as unknown as BusyWindow).__busyJobs?.settled ?? 0)) === HEAVY_JOBS, {
      timeout: 120000,
      timeoutMsg: "the OCR jobs did not stop after being cancelled",
    });

    expect(answer.ok).toBe(true);
    expect(answer.settled).toBe(0);
    expect(answer.ms).toBeLessThan(10000);
  });
});

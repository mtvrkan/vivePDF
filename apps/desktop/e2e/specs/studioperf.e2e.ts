import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { bootApp, openTool } from "../support/app.ts";

type Target = { x: number; y: number; id: string };
type DragReport = { moves: number; events: number; busyMs: number; busyPerMove: number; frames: number; p95: number; worstFrame: number; longTasks: number; worstLongTask: number; movedBy: number };

const MOVES = 120;
const report: Record<string, DragReport> = {};

async function pickTarget(text: boolean): Promise<Target | null> {
  return browser.execute((wantText: boolean) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="studio-viewport"] [data-element-id]'));
    const candidates = nodes
      .filter((node) => Boolean(node.querySelector("[data-text-body]")) === wantText)
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 30 && rect.height > 16)
      .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height);
    for (const { node, rect } of candidates) {
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-element-id]");
      if (hit === node && rect.width < window.innerWidth / 2) return { x, y, id: node.dataset.elementId as string };
    }
    return null;
  }, text);
}

async function startRecording() {
  await browser.execute(() => {
    const store = window as unknown as { __perf?: { frames: number[]; longTasks: number[]; observer: PerformanceObserver; running: boolean; busy: number; events: number; stop: () => void } };
    const frames: number[] = [];
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
    const channel = new MessageChannel();
    const countMove = () => {
      state.events += 1;
    };
    const state = {
      frames,
      longTasks,
      observer,
      running: true,
      busy: 0,
      events: 0,
      stop: () => {
        window.removeEventListener("pointermove", countMove, true);
        channel.port1.close();
      },
    };
    store.__perf = state;
    window.addEventListener("pointermove", countMove, true);
    let previous = performance.now();
    channel.port1.onmessage = () => {
      const now = performance.now();
      if (now - previous > 1) state.busy += now - previous;
      previous = now;
      if (state.running) channel.port2.postMessage(0);
    };
    channel.port2.postMessage(0);
    let last = performance.now();
    const tick = (now: number) => {
      if (!state.running) return;
      frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRecording(): Promise<{ frames: number[]; longTasks: number[]; busy: number; events: number }> {
  return browser.execute(() => {
    const store = window as unknown as { __perf: { frames: number[]; longTasks: number[]; observer: PerformanceObserver; running: boolean; busy: number; events: number; stop: () => void } };
    store.__perf.running = false;
    store.__perf.observer.disconnect();
    store.__perf.stop();
    return { frames: store.__perf.frames.slice(1), longTasks: store.__perf.longTasks, busy: store.__perf.busy, events: store.__perf.events };
  });
}

async function elementLeft(id: string): Promise<number> {
  return browser.execute((wanted: string) => {
    const node = document.querySelector<HTMLElement>(`[data-testid="studio-viewport"] [data-element-id="${wanted}"]`);
    return node ? node.getBoundingClientRect().left : Number.NaN;
  }, id);
}

async function drag(name: string, target: Target): Promise<DragReport> {
  const before = await elementLeft(target.id);
  await startRecording();
  let chain = browser.action("pointer").move({ origin: "viewport", x: target.x, y: target.y }).down();
  for (let step = 1; step <= MOVES; step += 1) {
    const offset = Math.round(Math.sin((step / MOVES) * Math.PI * 2) * 60);
    chain = chain.move({ origin: "viewport", x: target.x + offset, y: target.y + Math.round(step / 6), duration: 16 });
  }
  await chain.move({ origin: "viewport", x: target.x + 40, y: target.y + 20, duration: 16 }).up().perform();
  await browser.pause(300);
  const { frames, longTasks, busy, events } = await stopRecording();
  const sorted = [...frames].sort((left, right) => left - right);
  const result: DragReport = {
    moves: MOVES,
    events,
    busyMs: Math.round(busy),
    busyPerMove: Math.round((busy / Math.max(1, events)) * 10) / 10,
    frames: frames.length,
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    worstFrame: Math.round(sorted[sorted.length - 1] ?? 0),
    longTasks: longTasks.length,
    worstLongTask: Math.round(Math.max(0, ...longTasks)),
    movedBy: Math.round((await elementLeft(target.id)) - before),
  };
  report[name] = result;
  return result;
}

describe("studio performance", () => {
  before(bootApp);

  after(() => {
    writeFileSync(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studioperf.json"), JSON.stringify(report, null, 2));
    console.log(`studioperf ${JSON.stringify(report)}`);
  });

  it("drags a text box and a shape on a heavy template without long frames", async () => {
    await openTool("nav.studio");
    const card = $('[data-template="restaurantMenu"]');
    await card.waitForExist({ timeout: 15000 });
    await card.scrollIntoView({ block: "center" });
    await card.click();
    await $('[data-testid="studio-editor"]').waitForDisplayed({ timeout: 30000 });
    const banner = $('[data-testid="studio-missing-fonts"]');
    if (await banner.isExisting()) {
      await banner.$("button").click();
      await banner.waitForExist({ reverse: true, timeout: 120000 });
    }
    await browser.pause(1500);

    const text = await pickTarget(true);
    const shape = await pickTarget(false);
    if (!text || !shape) throw new Error("no draggable text box or shape found on the template");

    await startRecording();
    await browser.pause(2300);
    const idle = await stopRecording();
    report.idle = { moves: 0, events: idle.events, busyMs: Math.round(idle.busy), busyPerMove: 0, frames: idle.frames.length, p95: 0, worstFrame: Math.round(Math.max(0, ...idle.frames)), longTasks: idle.longTasks.length, worstLongTask: Math.round(Math.max(0, ...idle.longTasks)), movedBy: 0 };

    const textRun = await drag("text", text);
    const shapeRun = await drag("shape", shape);

    for (const run of [textRun, shapeRun]) {
      expect(run.movedBy).toBeGreaterThan(20);
      expect(run.worstLongTask).toBeLessThanOrEqual(100);
      expect(run.p95).toBeLessThan(34);
    }
  });
});

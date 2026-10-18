import * as logger from "@/shared/lib/logger";

export type FrameStats = { frames: number; average: number; p95: number; worst: number; slow: number };

const IDLE_MS = 400;
const MIN_FRAMES = 10;
const SLOW_FRAME_MS = 34;

export function frameStats(gaps: number[]): FrameStats {
  if (gaps.length === 0) return { frames: 0, average: 0, p95: 0, worst: 0, slow: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  return {
    frames: gaps.length,
    average: total / gaps.length,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
    worst: sorted[sorted.length - 1] ?? 0,
    slow: gaps.filter((gap) => gap > SLOW_FRAME_MS).length,
  };
}

export function scrollSummary(stats: FrameStats): string {
  return `${stats.frames} frames, average ${stats.average.toFixed(1)} ms, p95 ${Math.round(stats.p95)} ms, worst ${Math.round(stats.worst)} ms, ${stats.slow} over ${SLOW_FRAME_MS} ms`;
}

type FrameClock = {
  now: () => number;
  frame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
  later: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearLater: (handle: ReturnType<typeof setTimeout>) => void;
};

const browserClock: FrameClock = {
  now: () => performance.now(),
  frame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  later: (callback, ms) => setTimeout(callback, ms),
  clearLater: (handle) => clearTimeout(handle),
};

export function watchScrollFrames(target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window, clock: FrameClock = browserClock): () => void {
  let gaps: number[] = [];
  let last: number | null = null;
  let frameHandle: number | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const tick = (time: number) => {
    if (last !== null) gaps.push(time - last);
    last = time;
    frameHandle = clock.frame(tick);
  };

  const finish = () => {
    idle = null;
    if (frameHandle !== null) clock.cancelFrame(frameHandle);
    frameHandle = null;
    last = null;
    const burst = gaps;
    gaps = [];
    if (burst.length >= MIN_FRAMES) logger.info("scroll", scrollSummary(frameStats(burst)));
  };

  const onScroll = () => {
    if (frameHandle === null) frameHandle = clock.frame(tick);
    if (idle !== null) clock.clearLater(idle);
    idle = clock.later(finish, IDLE_MS);
  };

  target.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    target.removeEventListener("scroll", onScroll, { capture: true });
    if (idle !== null) clock.clearLater(idle);
    if (frameHandle !== null) clock.cancelFrame(frameHandle);
  };
}

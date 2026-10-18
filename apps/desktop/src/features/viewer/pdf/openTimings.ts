import * as logger from "@/shared/lib/logger";

export type OpenTimer = { step: (label: string) => void; summary: () => string; log: (detail: string) => void };

export function openTimer(now: () => number = () => performance.now()): OpenTimer {
  const started = now();
  let previous = started;
  const steps: string[] = [];
  const summary = () => [...steps, `total ${Math.round(now() - started)} ms`].join(", ");
  return {
    step: (label) => {
      const current = now();
      steps.push(`${label} ${Math.round(current - previous)} ms`);
      previous = current;
    },
    summary,
    log: (detail) => logger.info("open", `${detail}: ${summary()}`),
  };
}

export function sourceDetail(source: { kind: "buffer"; buffer: ArrayBuffer } | { kind: "range" }): string {
  return source.kind === "range" ? "in ranges" : `${(source.buffer.byteLength / 1048576).toFixed(1)} MB`;
}

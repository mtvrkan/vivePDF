import * as logger from "@/shared/lib/logger";

export const STARTUP_MARKS = { script: "vivepdf:script", mount: "vivepdf:mount", engine: "vivepdf:engine", ready: "vivepdf:ready" } as const;

type TimingSource = Pick<Performance, "getEntriesByName">;

const STEPS: Array<[label: string, name: string]> = [
  ["script", STARTUP_MARKS.script],
  ["mount", STARTUP_MARKS.mount],
  ["engine start", STARTUP_MARKS.engine],
  ["first paint", "first-contentful-paint"],
  ["ready", STARTUP_MARKS.ready],
];

export function markOnce(name: string, source: Pick<Performance, "getEntriesByName" | "mark"> = performance): void {
  if (source.getEntriesByName(name).length === 0) source.mark(name);
}

export function startupSummary(source: TimingSource = performance): string {
  return STEPS.map(([label, name]) => {
    const entry = source.getEntriesByName(name)[0];
    return `${label} ${entry ? `${Math.round(entry.startTime)} ms` : "-"}`;
  }).join(", ");
}

let logged = false;

export function logStartupReady(source: TimingSource = performance): void {
  if (logged) return;
  logged = true;
  logger.info("startup", startupSummary(source));
}

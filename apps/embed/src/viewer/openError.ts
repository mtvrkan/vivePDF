export type OpenProblem = "password" | "wrongPassword" | "notFound" | "network" | "damaged" | "unknown";

const ENGINE_NOT_FOUND = 2;
const ENGINE_WRONG_FORMAT = 3;
const ENGINE_PASSWORD = 4;
const GONE_STATUSES = [404, 410];

export type EngineFailure = { code?: number; message?: string };

export function problemFromStatus(status: number): OpenProblem {
  return GONE_STATUSES.includes(status) ? "notFound" : "network";
}

export function problemFromEngine(failure: EngineFailure | undefined, passwordProvided: boolean): OpenProblem {
  if (failure?.code === ENGINE_PASSWORD) return passwordProvided ? "wrongPassword" : "password";
  if (failure?.code === ENGINE_WRONG_FORMAT) return "damaged";
  if (failure?.code === ENGINE_NOT_FOUND) {
    const status = /\b(\d{3})\b/.exec(failure.message ?? "")?.[1];
    return status ? problemFromStatus(Number(status)) : "network";
  }
  return "unknown";
}

export function engineFailure(reason: unknown): EngineFailure | undefined {
  if (!reason || typeof reason !== "object") return undefined;
  const inner = "reason" in reason ? (reason as { reason: unknown }).reason : reason;
  if (!inner || typeof inner !== "object") return undefined;
  const { code, message } = inner as { code?: unknown; message?: unknown };
  return { code: typeof code === "number" ? code : undefined, message: typeof message === "string" ? message : undefined };
}

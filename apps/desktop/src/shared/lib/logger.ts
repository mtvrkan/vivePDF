import { invoke } from "@tauri-apps/api/core";

type LogLevel = "info" | "warn" | "error";

const THROTTLE_MS = 2000;

const lastLogged = new Map<string, number>();

function shouldLog(level: LogLevel, source: string, message: string): boolean {
  const key = `${level}:${source}:${message}`;
  const now = Date.now();
  const previous = lastLogged.get(key);
  if (previous !== undefined && now - previous < THROTTLE_MS) return false;
  lastLogged.set(key, now);
  return true;
}

function log(level: LogLevel, source: string, message: string): void {
  if (!shouldLog(level, source, message)) return;
  console[level](`[${source}] ${message}`);
  void invoke("log_line", { level, source, message }).catch(() => {});
}

export function info(source: string, message: string): void {
  log("info", source, message);
}

export function warn(source: string, message: string): void {
  log("warn", source, message);
}

export function error(source: string, message: string): void {
  log("error", source, message);
}

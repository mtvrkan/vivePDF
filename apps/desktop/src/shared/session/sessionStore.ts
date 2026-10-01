import { invoke } from "@tauri-apps/api/core";
import type { SessionSnapshot } from "@/types";

const SESSION_KEY = "vivepdf.session";
const CLEAN_EXIT_KEY = "vivepdf.cleanExit";
const RELOAD_KEY = "vivepdf.reloading";

function parseSnapshot(raw: string | null | undefined): SessionSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionSnapshot;
    return parsed && Array.isArray(parsed.documents) ? parsed : null;
  } catch {
    return null;
  }
}

function readMirror(): SessionSnapshot | null {
  try {
    return parseSnapshot(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function newer(first: SessionSnapshot | null, second: SessionSnapshot | null): SessionSnapshot | null {
  if (!first) return second;
  if (!second) return first;
  return (second.savedAt ?? 0) > (first.savedAt ?? 0) ? second : first;
}

let fileSnapshot: SessionSnapshot | null = null;
let writtenThisRun = false;
let fileWrites: Promise<void> = Promise.resolve();

export function readSession(): SessionSnapshot | null {
  return newer(readMirror(), fileSnapshot);
}

let startupSnapshot = readSession();

export async function loadSessionFile(): Promise<void> {
  let stored: SessionSnapshot | null = null;
  try {
    stored = parseSnapshot(await invoke<string | null>("session_read"));
  } catch {
    stored = null;
  }
  if (writtenThisRun) return;
  fileSnapshot = stored;
  startupSnapshot = newer(startupSnapshot, stored);
}

export function readStartupSession(): SessionSnapshot | null {
  return startupSnapshot;
}

export function writeSession(snapshot: SessionSnapshot | null) {
  writtenThisRun = true;
  fileSnapshot = snapshot;
  const contents = snapshot ? JSON.stringify(snapshot) : null;
  fileWrites = fileWrites.then(() => invoke("session_write", { contents })).then(
    () => undefined,
    () => undefined,
  );
  try {
    if (contents) localStorage.setItem(SESSION_KEY, contents);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    return;
  }
}

export function settledSessionWrites(): Promise<void> {
  return fileWrites;
}

export function wasCleanExit(): boolean {
  try {
    return localStorage.getItem(CLEAN_EXIT_KEY) !== "false";
  } catch {
    return true;
  }
}

export function markSessionRunning() {
  try {
    localStorage.setItem(CLEAN_EXIT_KEY, "false");
  } catch {
    return;
  }
}

export function markCleanExit() {
  try {
    localStorage.setItem(CLEAN_EXIT_KEY, "true");
  } catch {
    return;
  }
}

export function markPageReload() {
  markCleanExit();
  try {
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    return;
  }
}

export function consumePageReload(): boolean {
  try {
    const reloaded = sessionStorage.getItem(RELOAD_KEY) === "1";
    sessionStorage.removeItem(RELOAD_KEY);
    return reloaded;
  } catch {
    return false;
  }
}

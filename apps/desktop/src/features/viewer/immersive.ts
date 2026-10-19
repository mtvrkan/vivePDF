import { PhysicalPosition, PhysicalSize, availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import * as logger from "@/shared/lib/logger";
import { useUiStore } from "@/shared/store/uiStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { hasModKey, isFullscreenKey, isMac } from "@/shared/lib/platform";
import { holdTemporaryDrawings } from "./presentation/leftoverDrawings";

const SETTLE_MS = 160;
const LEAVE_ATTEMPTS = 6;

type Restore = { maximized: boolean; position: PhysicalPosition; size: PhysicalSize; forced: boolean; moved: boolean };

let restore: Restore | null = null;
let restoring = false;
let entering = false;
let savingDrawings = false;
let shownFullscreen = false;
const exitListeners = new Set<() => void>();

export function onImmersiveExit(listener: () => void): () => void {
  exitListeners.add(listener);
  return () => exitListeners.delete(listener);
}

const settle = () => new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS));

async function coversMonitor(): Promise<boolean> {
  const monitor = await currentMonitor();
  if (!monitor) return true;
  const size = await getCurrentWindow().innerSize();
  return size.width >= monitor.size.width && size.height >= monitor.size.height;
}

async function forceCover(): Promise<void> {
  const monitor = await currentMonitor();
  const appWindow = getCurrentWindow();
  if (!monitor) return;
  await appWindow.setFullscreen(false);
  await appWindow.setResizable(false);
  await appWindow.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
  await appWindow.setSize(new PhysicalSize(monitor.size.width, monitor.size.height));
  const inner = await appWindow.innerPosition();
  const offsetX = inner.x - monitor.position.x;
  const offsetY = inner.y - monitor.position.y;
  if (offsetX !== 0 || offsetY !== 0) await appWindow.setPosition(new PhysicalPosition(monitor.position.x - offsetX, monitor.position.y - offsetY));
  await appWindow.setAlwaysOnTop(true);
}

async function onSomeScreen(position: PhysicalPosition): Promise<boolean> {
  const monitors = await availableMonitors();
  if (monitors.length === 0) return true;
  return monitors.some(({ position: origin, size }) => position.x >= origin.x && position.x < origin.x + size.width && position.y >= origin.y && position.y < origin.y + size.height);
}

async function windowedAgain(): Promise<void> {
  const appWindow = getCurrentWindow();
  for (let attempt = 0; attempt < LEAVE_ATTEMPTS && (await appWindow.isFullscreen()); attempt += 1) await settle();
  await settle();
}

export function markWindowMoved(): void {
  if (restore) restore.moved = true;
}

export function exitImmersiveSavingDrawings(): Promise<void> {
  savingDrawings = true;
  return exitImmersive();
}

export async function exitImmersive(): Promise<void> {
  useUiStore.getState().setImmersive(false);
  if (restoring) return;
  restoring = true;
  holdTemporaryDrawings(savingDrawings ? "save" : "ask");
  savingDrawings = false;
  exitListeners.forEach((listener) => listener());
  const appWindow = getCurrentWindow();
  const entry = restore;
  restore = null;
  shownFullscreen = false;
  try {
    if (entry?.forced) {
      await appWindow.setAlwaysOnTop(false);
      await appWindow.setResizable(true);
    }
    await appWindow.setFullscreen(false);
    if (entry) {
      if (entry.forced || entry.moved) {
        if (entry.moved) await windowedAgain();
        if (await onSomeScreen(entry.position)) {
          await appWindow.setPosition(entry.position);
          await appWindow.setSize(entry.size);
        } else await appWindow.center();
      }
      if (entry.maximized) await appWindow.maximize();
    }
  } catch (error) {
    logger.error("immersive", error instanceof Error ? error.message : String(error));
  } finally {
    usePresentationStore.getState().resetSession();
    restoring = false;
  }
}

export async function setImmersiveFullscreen(next: boolean, startPage: number | null = null): Promise<void> {
  if (!next) {
    await exitImmersive();
    return;
  }
  if (entering || restoring) return;
  entering = true;
  const appWindow = getCurrentWindow();
  try {
    const entry: Restore = { maximized: await appWindow.isMaximized(), position: await appWindow.outerPosition(), size: await appWindow.innerSize(), forced: false, moved: false };
    restore = entry;
    if (entry.maximized) await appWindow.unmaximize();
    await appWindow.setFullscreen(true);
    await settle();
    if (!isMac && !(await coversMonitor())) {
      entry.forced = true;
      await forceCover();
    }
  } catch (error) {
    logger.error("immersive", error instanceof Error ? error.message : String(error));
  }
  entering = false;
  useUiStore.getState().setImmersive(true, startPage);
}

export async function followWindowFullscreen(): Promise<void> {
  if (entering || restoring || !restore || restore.forced || !useUiStore.getState().immersive) return;
  const fullscreen = await getCurrentWindow().isFullscreen();
  if (fullscreen) shownFullscreen = true;
  else if (shownFullscreen) await exitImmersive();
}

export type ImmersiveKeyContext = { immersive: boolean; mounted: boolean };

export function shouldExitOnKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey"> & Partial<Pick<KeyboardEvent, "metaKey" | "altKey" | "code">>, context: ImmersiveKeyContext, mac = isMac): boolean {
  if (!context.immersive) return false;
  if (isFullscreenKey({ ...event, metaKey: event.metaKey ?? false }, mac)) return true;
  if (hasModKey({ ctrlKey: event.ctrlKey, metaKey: event.metaKey ?? false }, mac) && event.shiftKey && event.key.toLowerCase() === "f") return true;
  if (event.key === "Escape" && !context.mounted) return true;
  return false;
}

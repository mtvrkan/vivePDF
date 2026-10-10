import { PhysicalPosition, PhysicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import * as logger from "@/shared/lib/logger";
import { useUiStore } from "@/shared/store/uiStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { hasModKey, isFullscreenKey, isMac } from "@/shared/lib/platform";

const SETTLE_MS = 160;

type Restore = { maximized: boolean; position: PhysicalPosition; size: PhysicalSize; forced: boolean };

let restore: Restore | null = null;
let restoring = false;
let entering = false;

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
  await appWindow.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
  await appWindow.setSize(new PhysicalSize(monitor.size.width, monitor.size.height));
  await appWindow.setAlwaysOnTop(true);
}

export async function exitImmersive(): Promise<void> {
  useUiStore.getState().setImmersive(false);
  if (restoring) return;
  restoring = true;
  const appWindow = getCurrentWindow();
  const entry = restore;
  restore = null;
  try {
    if (entry?.forced) await appWindow.setAlwaysOnTop(false);
    await appWindow.setFullscreen(false);
    if (entry) {
      if (entry.maximized) await appWindow.maximize();
      else if (entry.forced) {
        await appWindow.setPosition(entry.position);
        await appWindow.setSize(entry.size);
      }
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
    const entry: Restore = { maximized: await appWindow.isMaximized(), position: await appWindow.outerPosition(), size: await appWindow.innerSize(), forced: false };
    if (entry.maximized) await appWindow.unmaximize();
    await appWindow.setFullscreen(true);
    await settle();
    if (!isMac && !(await coversMonitor())) {
      await forceCover();
      entry.forced = true;
    }
    restore = entry;
  } finally {
    entering = false;
    useUiStore.getState().setImmersive(true, startPage);
  }
}

export type ImmersiveKeyContext = { immersive: boolean; mounted: boolean };

export function shouldExitOnKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey"> & Partial<Pick<KeyboardEvent, "metaKey" | "altKey" | "code">>, context: ImmersiveKeyContext, mac = isMac): boolean {
  if (!context.immersive) return false;
  if (isFullscreenKey({ ...event, metaKey: event.metaKey ?? false }, mac)) return true;
  if (hasModKey({ ctrlKey: event.ctrlKey, metaKey: event.metaKey ?? false }, mac) && event.shiftKey && event.key.toLowerCase() === "f") return true;
  if (event.key === "Escape" && !context.mounted) return true;
  return false;
}

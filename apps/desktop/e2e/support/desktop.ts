import { execFileSync } from "node:child_process";
import { $, $$, browser } from "@wdio/globals";

export const PAGE_WIDTH = 595;

export function powershell(script: string): string {
  return execFileSync("powershell", ["-NoProfile", "-STA", "-Command", `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`], { encoding: "utf8" });
}

export function clearClipboard() {
  powershell("Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::Clear()");
}

export function clipboardText(): string {
  return powershell("Get-Clipboard -Raw").replace(/\r\n/g, "\n").replace(/\n$/, "");
}

export function clipboardPicture(): { width: number; height: number } | null {
  const size = powershell("Add-Type -AssemblyName System.Windows.Forms; $picture = [Windows.Forms.Clipboard]::GetImage(); if ($picture) { \"$($picture.Width)x$($picture.Height)\" }").trim();
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

export async function waitForClipboardText(expected: (text: string) => boolean, what: string) {
  let last = "";
  try {
    await browser.waitUntil(
      () => {
        last = clipboardText();
        return expected(last);
      },
      { timeout: 15000, interval: 400 },
    );
  } catch {
    const alerts = await $$('[role="alert"]').map((alert) => alert.getText());
    throw new Error(`${what}: clipboard held ${JSON.stringify(last)}; alerts ${JSON.stringify(alerts)}`);
  }
  return last;
}

export async function waitForClipboardPicture(what: string) {
  let picture: { width: number; height: number } | null = null;
  await browser.waitUntil(
    () => {
      picture = clipboardPicture();
      return picture !== null;
    },
    { timeout: 20000, interval: 500, timeoutMsg: `${what}: no picture on the clipboard` },
  );
  return picture as unknown as { width: number; height: number };
}

export async function pagePoints(pageIndex: number, points: Array<[number, number]>, pageWidth = PAGE_WIDTH) {
  const page = $(`[data-page-index="${pageIndex}"]`);
  await page.waitForExist();
  await browser.waitUntil(async () => (await page.$$("img, canvas").length) > 0, { timeoutMsg: `page ${pageIndex + 1} never rendered` });
  const box = await browser.execute(
    (index: number, ys: number[], width: number) => {
      const element = document.querySelector(`[data-page-index="${index}"]`) as HTMLElement;
      const measure = () => element.getBoundingClientRect();
      let rect = measure();
      const scale = rect.width / width;
      const middle = rect.top + ((Math.min(...ys) + Math.max(...ys)) / 2) * scale;
      const top = 160;
      const bottom = window.innerHeight - 80;
      if (rect.top + Math.min(...ys) * scale < top || rect.top + Math.max(...ys) * scale > bottom) {
        let scroller = element.parentElement;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        scroller?.scrollBy({ top: middle - (top + bottom) / 2, behavior: "instant" });
        rect = measure();
      }
      return { left: rect.left, top: rect.top, width: rect.width };
    },
    pageIndex,
    points.map(([, y]) => y),
    pageWidth,
  );
  const scale = box.width / pageWidth;
  return points.map(([x, y]) => ({ origin: "viewport" as const, x: Math.round(box.left + x * scale), y: Math.round(box.top + y * scale) }));
}

export async function pagePoint(pageIndex: number, x: number, y: number, pageWidth = PAGE_WIDTH) {
  const [point] = await pagePoints(pageIndex, [[x, y]], pageWidth);
  return point;
}

export type ScreenPoint = { x: number; y: number };

export type WindowFrame = { x: number; y: number; width: number; height: number; scale: number; work: { x: number; y: number; width: number; height: number } };

type MouseStep = ScreenPoint | "down" | "up";

const MOUSE =
  "Add-Type -Namespace E2e -Name Mouse -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);'; [void][E2e.Mouse]::SetProcessDPIAware();";

export function glide(from: ScreenPoint, to: ScreenPoint, steps = 24): ScreenPoint[] {
  return Array.from({ length: steps }, (_, index) => {
    const share = (index + 1) / steps;
    return { x: Math.round(from.x + (to.x - from.x) * share), y: Math.round(from.y + (to.y - from.y) * share) };
  });
}

export function nativeMouse(steps: MouseStep[]) {
  const script = steps
    .map((step) => {
      if (step === "down") return "[E2e.Mouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80;";
      if (step === "up") return "[E2e.Mouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80;";
      return `[void][E2e.Mouse]::SetCursorPos(${step.x}, ${step.y}); Start-Sleep -Milliseconds 16;`;
    })
    .join(" ");
  powershell(`${MOUSE} ${script}`);
}

type Bridge = { invoke: <T>(command: string, args: unknown) => Promise<T>; metadata: { currentWindow: { label: string } } };

export async function windowFrame(): Promise<WindowFrame> {
  return browser.executeAsync((done: (frame: WindowFrame) => void) => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: Bridge }).__TAURI_INTERNALS__;
    const label = bridge.metadata.currentWindow.label;
    Promise.all([
      bridge.invoke<{ x: number; y: number }>("plugin:window|outer_position", { label }),
      bridge.invoke<{ width: number; height: number }>("plugin:window|outer_size", { label }),
      bridge.invoke<number>("plugin:window|scale_factor", { label }),
    ]).then(([position, size, scale]) => {
      const area = window.screen as Screen & { availLeft?: number; availTop?: number };
      done({
        ...position,
        ...size,
        scale,
        work: { x: Math.round((area.availLeft ?? 0) * scale), y: Math.round((area.availTop ?? 0) * scale), width: Math.round(area.availWidth * scale), height: Math.round(area.availHeight * scale) },
      });
    });
  });
}

export async function placeWindow(x: number, y: number, width: number, height: number) {
  await browser.executeAsync(
    (left: number, top: number, wide: number, high: number, done: () => void) => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: Bridge }).__TAURI_INTERNALS__;
      const label = bridge.metadata.currentWindow.label;
      bridge
        .invoke("plugin:window|unmaximize", { label })
        .then(() => bridge.invoke("plugin:window|set_size", { label, value: { Physical: { width: wide, height: high } } }))
        .then(() => bridge.invoke("plugin:window|set_position", { label, value: { Physical: { x: left, y: top } } }))
        .then(done, done);
    },
    x,
    y,
    width,
    height,
  );
  await browser.waitUntil(
    async () => {
      const frame = await windowFrame();
      return Math.abs(frame.x - x) <= 2 && Math.abs(frame.y - y) <= 2;
    },
    { timeout: 10000, timeoutMsg: `the window did not move to ${x},${y}` },
  );
}

export async function screenPointOf(element: ReturnType<typeof $>, offsetX = 0): Promise<ScreenPoint> {
  await element.waitForDisplayed();
  const frame = await windowFrame();
  const box = await browser.execute((target) => {
    const rect = (target as HTMLElement).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, innerWidth: window.innerWidth };
  }, await element);
  const ratio = frame.width / box.innerWidth;
  return { x: Math.round(frame.x + (box.left + box.width / 2 + offsetX) * ratio), y: Math.round(frame.y + (box.top + box.height / 2) * ratio) };
}

export async function screenEdgeOf(element: ReturnType<typeof $>, edge: "left" | "right", inset = 6): Promise<ScreenPoint> {
  const { width } = await element.getSize();
  return screenPointOf(element, edge === "left" ? -width / 2 + inset : width / 2 - inset);
}

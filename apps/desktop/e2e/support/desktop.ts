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

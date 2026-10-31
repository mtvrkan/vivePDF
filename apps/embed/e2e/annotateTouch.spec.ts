import { expect, test, type Page } from "@playwright/test";
import type { VivePdfViewer } from "../src/api/types";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");
const element = (page: Page) => page.locator("vive-pdf");
const panning = (page: Page) => viewer(page).locator('[data-page-index="0"]').evaluate((node) => getComputedStyle(node.closest(".vp-page") ?? node).touchAction);
const pens = async (page: Page) => (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).filter((entry) => entry.type === "pen").length;

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !isMobile, "finger drags are sent through Chromium's DevTools protocol");

async function openViewer(page: Page): Promise<void> {
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/book.pdf&zoom=fit-width&annotate");
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
}

async function fingerDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const session = await page.context().newCDPSession(page);
  const at = (x: number, y: number) => [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(from.x, from.y) });
  for (let step = 1; step <= 12; step += 1) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(from.x + ((to.x - from.x) * step) / 12, from.y + ((to.y - from.y) * step) / 12) });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

async function pageMiddle(page: Page): Promise<{ x: number; y: number; height: number }> {
  const box = await viewer(page).locator(".vp-viewport").boundingBox();
  if (!box) throw new Error("viewer not shown");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, height: box.height };
}

test("a finger drag with the pen on draws and stops the page from panning", async ({ page }) => {
  await openViewer(page);
  await element(page).evaluate((node: VivePdfViewer) => node.setTool("pen"));
  const middle = await pageMiddle(page);

  await fingerDrag(page, { x: middle.x - 60, y: middle.y + 80 }, { x: middle.x + 40, y: middle.y - 80 });

  await expect.poll(() => pens(page)).toBe(1);
  expect(await panning(page)).toBe("none");
});

test("with the drawing bar open but no tool on, a finger drag pans and does not draw", async ({ page }) => {
  await openViewer(page);
  await viewer(page).getByRole("button", { name: "Draw and annotate" }).click();
  const middle = await pageMiddle(page);

  await fingerDrag(page, { x: middle.x - 60, y: middle.y + 80 }, { x: middle.x + 40, y: middle.y - 80 });

  expect(await panning(page)).not.toBe("none");
  expect(await pens(page)).toBe(0);
});

test("a finger drag with the eraser cuts the pen line it crosses", async ({ page }) => {
  await openViewer(page);
  await element(page).evaluate((node: VivePdfViewer) => node.setTool("pen"));
  const middle = await pageMiddle(page);
  await fingerDrag(page, { x: middle.x - 100, y: middle.y }, { x: middle.x + 100, y: middle.y });
  await expect.poll(() => pens(page)).toBe(1);
  await element(page).evaluate((node: VivePdfViewer) => node.setTool("eraser"));

  await fingerDrag(page, { x: middle.x, y: middle.y - 40 }, { x: middle.x, y: middle.y + 40 });

  await expect.poll(async () => (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).flatMap((entry) => (entry.type === "pen" ? [entry.strokes.length] : []))).toEqual([2]);
});

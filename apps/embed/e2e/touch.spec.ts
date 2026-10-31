import { expect, test, type Page } from "@playwright/test";
import type { VivePdfViewer } from "../src/api/types";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");
const scrollTop = (page: Page) => viewer(page).locator(".vp-viewport").evaluate((node) => node.scrollTop);

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !isMobile, "finger gestures are sent through Chromium's DevTools protocol");

async function openBook(page: Page): Promise<{ x: number; y: number; height: number }> {
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/book.pdf&zoom=fit-width");
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), height: box.height };
}

test("a finger swipe on a page scrolls the document", async ({ page }) => {
  const middle = await openBook(page);
  const before = await scrollTop(page);
  const session = await page.context().newCDPSession(page);

  await session.send("Input.synthesizeScrollGesture", { x: middle.x, y: middle.y, yDistance: -Math.round(middle.height / 3), gestureSourceType: "touch", speed: 800 });

  await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + 50);
});

test("pinching a page zooms the document, not the web page", async ({ page }) => {
  const middle = await openBook(page);
  const before = await page.locator("vive-pdf").evaluate((node: VivePdfViewer) => node.zoom);
  const session = await page.context().newCDPSession(page);

  await session.send("Input.synthesizePinchGesture", { x: middle.x, y: middle.y, scaleFactor: 2, gestureSourceType: "touch", relativeSpeed: 400 });

  await expect.poll(() => page.locator("vive-pdf").evaluate((node: VivePdfViewer) => node.zoom)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
});

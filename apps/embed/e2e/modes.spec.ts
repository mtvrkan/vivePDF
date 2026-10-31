import { expect, test, type Page } from "@playwright/test";
import type { VivePdfViewer } from "../src/api/types";

type ViewerEvent = { type: string; detail: unknown };

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const events = (page: Page) => page.evaluate(() => (window as unknown as { __events: ViewerEvent[] }).__events.map((event) => event.type));
const viewer = (page: Page) => page.getByTestId("viewer");
const element = (page: Page) => page.locator("vive-pdf");
const pageBox = (page: Page) => viewer(page).getByRole("textbox", { name: "Page number" });
const hostBox = (page: Page) => element(page).evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect);

async function openViewer(page: Page, query: string, until = "first-page"): Promise<void> {
  await page.goto(`/e2e/playground.html?lang=en&${query}`);
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain(until);
}

test("without a mode the viewer is a 600 pixel box that scrolls on its own", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf&mode=sized");

  const box = await hostBox(page);

  expect(box.height).toBe(600);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual((await page.viewportSize())!.height);
});

test("full mode fills the height of the window", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf&mode=full");

  const box = await hostBox(page);

  expect(Math.round(box.height)).toBe((await page.viewportSize())!.height);
});

test("inline mode grows with the document and turns pages as the web page scrolls", async ({ page, isMobile }) => {
  await openViewer(page, "src=/fixtures/book.pdf&mode=inline&pad=300");
  const window = (await page.viewportSize())!;

  const box = await hostBox(page);
  if (isMobile) await page.evaluate((distance) => window.scrollBy(0, distance), box.height / 2);
  else {
    await page.mouse.move(window.width / 2, window.height / 2);
    await page.mouse.wheel(0, box.height / 2);
  }

  expect(box.height).toBeGreaterThan(window.height * 50);
  await expect.poll(async () => Number(await pageBox(page).inputValue())).toBeGreaterThan(200);
  await expect.poll(async () => Number(await pageBox(page).inputValue())).toBeLessThan(300);
  const toolbar = await viewer(page).getByRole("toolbar", { name: "Document tools" }).boundingBox();
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(window.height);
});

test("in inline mode the page box moves the web page to that page", async ({ page }) => {
  await openViewer(page, "src=/fixtures/book.pdf&mode=inline&pad=300");

  await pageBox(page).fill("40");
  await pageBox(page).press("Enter");

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await expect(pageBox(page)).toHaveValue("40");
  const before = await page.evaluate(() => document.getElementById("before")!.getBoundingClientRect().bottom);
  expect(before).toBeLessThan(0);
});

test("lightbox mode takes no room, loads nothing until shown and closes with its button", async ({ page }) => {
  const engineRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("pdfium.wasm")) engineRequests.push(request.url());
  });
  await openViewer(page, "src=/fixtures/links.pdf&mode=lightbox&pad=200", "connected");

  await page.waitForTimeout(500);
  expect(engineRequests).toEqual([]);
  expect(await page.evaluate(() => document.getElementById("after")!.getBoundingClientRect().top)).toBe(200);
  await element(page).evaluate((node: VivePdfViewer) => node.show());

  await expect(viewer(page).getByRole("dialog", { name: "PDF viewer" })).toBeVisible();
  await expect(viewer(page).getByText("/ 3")).toBeVisible({ timeout: 20_000 });
  await viewer(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(viewer(page).getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => events(page)).toContain("vive-close");
});

test("open() in lightbox mode shows the file, Escape closes search first and then the lightbox", async ({ page, isMobile }) => {
  test.skip(isMobile, "Escape needs a hardware keyboard");
  await openViewer(page, "src=none&mode=lightbox", "connected");

  await element(page).evaluate((node: VivePdfViewer) => node.open("/fixtures/small.pdf"));
  await viewer(page).getByRole("button", { name: "Search", exact: true }).click();
  await expect(viewer(page).getByRole("searchbox", { name: "Search in document" })).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(viewer(page).getByRole("searchbox")).toHaveCount(0);
  await expect(viewer(page).getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer(page).getByRole("dialog")).toHaveCount(0);
});

test("switching mode keeps the open document", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf&mode=sized");

  await element(page).evaluate((node) => node.setAttribute("mode", "lightbox"));
  await element(page).evaluate((node: VivePdfViewer) => node.show());
  await expect(viewer(page).getByRole("dialog")).toBeVisible();
  await element(page).evaluate((node: VivePdfViewer) => node.close());
  await element(page).evaluate((node) => node.setAttribute("mode", "sized"));

  await expect(viewer(page).getByText("/ 3")).toBeVisible();
  expect((await hostBox(page)).height).toBe(600);
  expect((await events(page)).filter((type) => type === "vive-ready")).toHaveLength(1);
});

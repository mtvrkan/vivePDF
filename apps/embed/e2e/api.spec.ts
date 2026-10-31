import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { VivePdfViewer } from "../src/api/types";

type ViewerEvent = { type: string; detail: Record<string, unknown> };

const LINKS = [...readFileSync(new URL("../bench/fixtures/links.pdf", import.meta.url))];

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const events = (page: Page) => page.evaluate(() => (window as unknown as { __events: ViewerEvent[] }).__events);
const eventsOf = async (page: Page, type: string) => (await events(page)).filter((event) => event.type === type).map((event) => event.detail);
const viewer = (page: Page) => page.getByTestId("viewer");
const pageBox = (page: Page) => viewer(page).getByRole("textbox", { name: "Page number" });
const element = (page: Page) => page.locator("vive-pdf");

async function openViewer(page: Page, query: string, until = "first-page"): Promise<void> {
  await page.goto(`/e2e/playground.html?lang=en&${query}`);
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain(until);
}

test("the element tells the page when the document is ready, the page turns and the zoom changes", async ({ page }) => {
  await openViewer(page, "src=/fixtures/book.pdf");

  await expect.poll(() => eventsOf(page, "vive-ready")).toEqual([{ pageCount: 500 }]);
  await element(page).evaluate((node: VivePdfViewer) => node.goTo(12));
  await element(page).evaluate((node: VivePdfViewer) => node.setZoom(150));

  await expect(pageBox(page)).toHaveValue("12");
  await expect.poll(async () => (await eventsOf(page, "vive-pagechange")).at(-1)).toEqual({ page: 12, pageCount: 500 });
  await expect.poll(async () => (await eventsOf(page, "vive-zoomchange")).at(-1)).toEqual({ zoom: 150 });
  expect(await element(page).evaluate((node: VivePdfViewer) => [node.page, node.pageCount, node.zoom])).toEqual([12, 500, 150]);
});

test("page and zoom attributes set where the document opens and move it when changed", async ({ page }) => {
  await openViewer(page, "src=/fixtures/book.pdf&page=30&zoom=fit-page");

  await expect(pageBox(page)).toHaveValue("30");
  const fitted = (await eventsOf(page, "vive-zoomchange")).at(-1)?.zoom as number;
  await element(page).evaluate((node) => node.setAttribute("page", "45"));
  await element(page).evaluate((node) => node.setAttribute("zoom", "200%"));

  await expect(pageBox(page)).toHaveValue("45");
  await expect.poll(async () => (await eventsOf(page, "vive-zoomchange")).at(-1)).toEqual({ zoom: 200 });
  expect(fitted).toBeLessThan(200);
});

test("changing src opens the new document and open() resolves once it is ready", async ({ page }) => {
  await openViewer(page, "src=/fixtures/book.pdf");

  const pageCount = await element(page).evaluate(async (node: VivePdfViewer) => {
    await node.open("/fixtures/links.pdf");
    return node.pageCount;
  });

  expect(pageCount).toBe(3);
  await expect(viewer(page).getByText("/ 3")).toBeVisible();
});

test("open() takes the bytes of a file and downloads them under the file's name", async ({ page }) => {
  await openViewer(page, "src=none", "connected");

  await element(page).evaluate(async (node: VivePdfViewer, bytes) => {
    await node.open(new File([new Uint8Array(bytes)], "Report.pdf", { type: "application/pdf" }));
  }, LINKS);
  const saved = page.waitForEvent("download");
  await element(page).evaluate((node: VivePdfViewer) => node.download());
  const download = await saved;

  await expect(viewer(page).getByText("/ 3")).toBeVisible();
  expect(download.suggestedFilename()).toBe("Report.pdf");
  expect([...readFileSync(await download.path())]).toEqual(LINKS);
});

test("open() rejects with an error code when the file cannot be opened", async ({ page }) => {
  await openViewer(page, "src=/fixtures/small.pdf");

  const code = await element(page).evaluate((node: VivePdfViewer) => node.open("/fixtures/garbage.pdf").then(() => "opened", (error: { code: string }) => error.code));

  expect(code).toBe("damaged");
  expect(await eventsOf(page, "vive-error")).toEqual([{ code: "damaged" }]);
});

test("search() looks a word up from outside the viewer", async ({ page }) => {
  await openViewer(page, "src=/fixtures/book.pdf");

  await element(page).evaluate((node: VivePdfViewer) => node.search("Chapter 40"));

  await expect(viewer(page).getByRole("searchbox", { name: "Search in document" })).toHaveValue("Chapter 40");
  await expect(viewer(page).locator(".vp-search-count")).toHaveText(/^1 of \d+$/, { timeout: 15_000 });
  await expect(pageBox(page)).toHaveValue("40");
});

test("a site can hide search", async ({ page, isMobile }) => {
  await openViewer(page, "src=/fixtures/small.pdf&search=off");

  if (!isMobile) {
    await viewer(page).getByRole("region", { name: "Document pages" }).focus();
    await page.keyboard.press("ControlOrMeta+f");
  }

  await expect(viewer(page).getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
  await expect(viewer(page).getByRole("searchbox")).toHaveCount(0);
});

test("live attribute changes restyle the viewer without reopening the document", async ({ page }) => {
  await openViewer(page, "src=/fixtures/small.pdf&accent=rebeccapurple");
  const accent = () => element(page).evaluate((node) => node.style.getPropertyValue("--vp-accent"));

  expect(await accent()).toBe("rebeccapurple");
  await element(page).evaluate((node) => {
    node.setAttribute("accent", "url(javascript:alert(1))");
    node.setAttribute("lang", "tr");
    node.setAttribute("theme", "dark");
  });

  expect(await accent()).toBe("");
  await expect(viewer(page).getByRole("textbox", { name: "Sayfa numarası" })).toBeVisible();
  await expect(viewer(page).locator(".vp")).toHaveAttribute("data-theme", "dark");
  expect(await eventsOf(page, "vive-ready")).toHaveLength(1);
});

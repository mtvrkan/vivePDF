import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

type PrintCall = { pages: number; loaded: number };

const OTHER_SITE = "http://127.0.0.1:4311";
const LINKS = readFileSync(new URL("../bench/fixtures/links.pdf", import.meta.url));

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: PrintCall[] }).__prints);
const viewer = (page: Page) => page.getByTestId("viewer");

async function openViewer(page: Page, query: string): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as { __prints: PrintCall[] };
    target.__prints = [];
    window.print = () => {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".vivepdf-print-root img"));
      target.__prints.push({ pages: document.querySelector(".vivepdf-print-root")?.children.length ?? 0, loaded: images.filter((image) => image.naturalWidth > 0).length });
    };
  });
  await page.goto(`/e2e/playground.html?lang=en&${query}`);
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
}

async function chooseFromMenu(page: Page, item: string): Promise<void> {
  await viewer(page).getByRole("button", { name: "More options" }).click();
  await viewer(page).getByRole("menuitem", { name: item }).click();
}

test("print lays every page out as a picture, opens the print dialog and cleans up after", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf");

  await chooseFromMenu(page, "Print");

  await expect.poll(() => prints(page)).toEqual([{ pages: 3, loaded: 3 }]);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".vivepdf-print-root")).toHaveCount(0);
  expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
});

test("printing a long document shows its progress and can be cancelled", async ({ page }) => {
  await openViewer(page, "src=/fixtures/book.pdf");

  await chooseFromMenu(page, "Print");
  const status = viewer(page).getByRole("status").filter({ hasText: "Preparing pages for printing" });
  await expect(status).toContainText("/ 500");
  await status.getByRole("button", { name: "Cancel" }).click();

  await expect(status).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await prints(page)).toEqual([]);
  await expect(page.locator(".vivepdf-print-root")).toHaveCount(0);
});

test("Ctrl+P inside the viewer prints the document instead of the web page", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts need a hardware keyboard");
  await openViewer(page, "src=/fixtures/small.pdf");

  await viewer(page).getByRole("region", { name: "Document pages" }).focus();
  await page.keyboard.press("ControlOrMeta+p");

  await expect.poll(() => prints(page)).toEqual([{ pages: 2, loaded: 2 }]);
});

test("download saves the original file under its own name or the one the site gives", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf&filename=Price%20list");

  const saved = page.waitForEvent("download");
  await chooseFromMenu(page, "Download");
  const download = await saved;

  expect(download.suggestedFilename()).toBe("Price list.pdf");
  expect(readFileSync(await download.path())).toEqual(LINKS);
});

test("a file from another site is downloaded with its name rather than opened", async ({ page }) => {
  await openViewer(page, `src=${OTHER_SITE}/fixtures/links.pdf`);

  const saved = page.waitForEvent("download");
  await chooseFromMenu(page, "Download");
  const download = await saved;

  expect(download.suggestedFilename()).toBe("links.pdf");
  expect(readFileSync(await download.path())).toEqual(LINKS);
});

test("a site can hide print and download", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf&print=false&download=off");

  await viewer(page).getByRole("button", { name: "More options" }).click();

  await expect(viewer(page).getByRole("menuitemradio", { name: "Single page" })).toBeVisible();
  await expect(viewer(page).getByRole("menuitem", { name: "Print" })).toHaveCount(0);
  await expect(viewer(page).getByRole("menuitem", { name: "Download" })).toHaveCount(0);
});

test("a site can hide the whole toolbar", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf&toolbar=false");

  const toolbars = viewer(page).getByRole("toolbar");

  await expect(toolbars).toHaveCount(0);
  await expect(viewer(page).getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
});

test("the toolbar links to vivePDF in a new tab", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf");

  const brand = viewer(page).getByRole("link", { name: "Shown with vivePDF" });

  await expect(brand).toBeVisible();
  await expect(brand).toHaveAttribute("href", "https://vivepdf.com/?ref=viewer");
  await expect(brand).toHaveAttribute("target", "_blank");
});

test("a site can hide the vivePDF link", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf&branding=false");

  await expect(viewer(page).getByRole("toolbar", { name: "Document tools" })).toBeVisible();
  await expect(viewer(page).getByRole("link", { name: "Shown with vivePDF" })).toHaveCount(0);
});

test("a damaged file offers no download link when the site turned downloads off", async ({ page }) => {
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/garbage.pdf&download=false");
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("open-error");

  await expect(viewer(page).getByRole("alert")).toContainText("The file is damaged");
  await expect(viewer(page).getByRole("link", { name: "Download the file" })).toHaveCount(0);
});
